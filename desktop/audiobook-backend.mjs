import { spawn } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KokoroTTS } from 'kokoro-js';
import { AutoTokenizer, env } from '@huggingface/transformers';
import { guardTokenWindow } from './speech-input.mjs';
import { generateVoice } from './speech-voice.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const identities = new Map();
async function digestFile(filename) {
  const info = await stat(filename), key = filename + ':' + info.size + ':' + info.mtimeMs;
  if (identities.has(key)) return identities.get(key);
  const hash = createHash('sha256'); for await (const bytes of createReadStream(filename)) hash.update(bytes);
  const digest = hash.digest('hex'); identities.set(key, digest); return digest;
}
export async function exportIdentity({ engine, runtimeRoot, modelRoot }) {
  if (!['kokoro-cuda', 'kokoro-cpu'].includes(engine)) throw new Error('This export model has been removed.');
  const files = ['speech-input.mjs', 'speech-voice.mjs', 'export-core.mjs'].map(name => path.join(directory, name));
  for (const name of ['onnx/model.onnx', 'tokenizer.json', 'tokenizer_config.json']) files.push(path.join(modelRoot, 'onnx-community/Kokoro-82M-v1.0-ONNX', name));
  // Keep the verified helper bytes so interrupted Kokoro jobs remain compatible.
  files.push(path.join(runtimeRoot, 'ort-resolved.txt'), path.join(directory, 'audiobook-python.py'));
  return createHash('sha256').update(JSON.stringify(await Promise.all(files.map(digestFile)))).digest('hex');
}
export async function runtimeConfiguration(root) {
  const base = await realpath(root), config = JSON.parse((await readFile(path.join(base, 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
  for (const key of ['ortPython', 'ffmpeg', 'ffprobe']) {
    const resolved = path.resolve(base, config[key]);
    if (!resolved.startsWith(base + path.sep)) throw new Error('The audiobook runtime path is invalid.');
    config[key] = resolved;
  }
  return config;
}

class PythonAudio {
  pending = new Map(); sequence = 0; buffer = Buffer.alloc(0); header; log = ''; closed = false;
  constructor(executable, engine, model) {
    this.ready = new Promise((resolve, reject) => this.pending.set(0, { resolve, reject }));
    const helper = path.join(directory, 'audiobook-python.py').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    this.child = spawn(executable, ['-u', helper, '--engine', engine, '--model', model], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_IMPLICIT_TOKEN: '1' } });
    this.child.stdout.on('data', data => { try { this.receive(data); } catch (error) { this.fail(error); } });
    this.child.stderr.on('data', data => { this.log = (this.log + data).slice(-16000); });
    this.child.on('error', error => this.fail(error));
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    this.child.on('close', code => { this.closed = true; if (this.pending.size) this.fail(new Error(`The local export engine stopped (${code}). ${this.log.slice(-1600)}`)); });
    this.timer = setTimeout(() => { this.fail(new Error('The local export model did not finish loading.')); this.child.kill(); }, 180000);
    this.ready.finally(() => clearTimeout(this.timer)).catch(() => {});
  }
  fail(error) { for (const item of this.pending.values()) item.reject(error); this.pending.clear(); }
  receive(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length) {
      if (!this.header) {
        const at = this.buffer.indexOf(10);
        if (at < 0) { if (this.buffer.length > 8192) throw new Error('Invalid export engine response.'); return; }
        const line = this.buffer.subarray(0, at).toString('utf8'); this.buffer = this.buffer.subarray(at + 1);
        if (!line.startsWith('CADENCE1 ')) { this.log = (this.log + line).slice(-16000); continue; }
        this.header = JSON.parse(line.slice(9));
        if (!Number.isSafeInteger(this.header.bytes) || this.header.bytes < 0 || this.header.bytes > 32 * 1024 * 1024 || this.header.bytes % 4) throw new Error('Invalid export audio length.');
      }
      if (this.buffer.length < this.header.bytes) return;
      const header = this.header, bytes = this.buffer.subarray(0, header.bytes); this.buffer = this.buffer.subarray(header.bytes); this.header = undefined;
      const item = this.pending.get(header.id); this.pending.delete(header.id);
      if (!item) continue;
      if (header.error) { const error = new Error(header.error); error.detail = header.detail || this.log.slice(-3000); item.reject(error); }
      else item.resolve({ ...header, samples: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) });
    }
  }
  request(input) {
    if (this.closed) return Promise.reject(new Error('The export engine is closed.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.child.stdin.write(JSON.stringify({ id, ...input }) + '\n', error => { if (error) { this.pending.delete(id); reject(error); } }); });
  }
  async close(force = false) {
    clearTimeout(this.timer);
    if (this.closed) return;
    const timer = setTimeout(() => this.child.kill(), 5000);
    try {
      if (force) this.child.kill();
      else { try { await this.request({ action: 'shutdown' }); } catch { /* The failed child may already have exited. */ } this.child.stdin.end(); }
      await this.exited;
    } finally { clearTimeout(timer); }
  }
}

export async function createExportBackend({ engine, runtimeRoot, modelRoot }) {
  env.cacheDir = modelRoot; env.allowRemoteModels = false;
  let python, network, details;
  if (engine === 'kokoro-cuda' || engine === 'kokoro-cpu') {
    const configuration = await runtimeConfiguration(runtimeRoot);
    python = new PythonAudio(configuration.ortPython, engine === 'kokoro-cpu' ? 'kokoro-cpu' : 'kokoro', path.join(modelRoot, 'onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx'));
    try { details = await python.ready; } catch (error) { await python.close(true); throw error; }
    network = async ({ input_ids, style }) => { const result = await python.request({ input_ids: Array.from(input_ids.data, Number), style: Array.from(style.data) }); return { waveform: { data: result.samples } }; };
  } else throw new Error('Choose a supported export model.');
  try {
    const tokenizer = await AutoTokenizer.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX'), tts = guardTokenWindow(new KokoroTTS(network, tokenizer));
    return { details, generate: (text, voice, cancelled = () => {}) => generateVoice(tts, text, voice, cancelled), close: force => python.close(force) };
  } catch (error) { await python.close(true); throw error; }
}
