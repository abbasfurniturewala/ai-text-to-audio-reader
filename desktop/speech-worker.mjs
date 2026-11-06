import { parentPort, workerData } from 'node:worker_threads';
import { KokoroTTS } from 'kokoro-js';
import { env, StyleTextToSpeech2Model, AutoTokenizer, RawAudio } from '@huggingface/transformers';
import { guardTokenWindow } from './speech-input.mjs';
import { generateVoice } from './speech-voice.mjs';
import { mkdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
env.cacheDir = workerData.cacheDir;
env.allowRemoteModels = !workerData.offline;
let modelPromise;
async function model() {
  if (!modelPromise) {
    await mkdir(env.cacheDir, { recursive: true });
    const id = 'onnx-community/Kokoro-82M-v1.0-ONNX';
    const progress_callback = progress => parentPort.postMessage({ type: 'progress', progress });
    // Full precision benchmarks faster than dynamic int8 quantization on this
    // Windows CPU. A small thread pool avoids expensive oversubscription.
    modelPromise = Promise.all([
      StyleTextToSpeech2Model.from_pretrained(id, {
        dtype: 'fp32', device: 'cpu', progress_callback,
        // Speech has changing tensor shapes. Pattern caching retains extra
        // allocations for each shape; benchmarking found no speed gain here.
        // Keep the CPU arena and the full-quality model for fast generation.
        session_options: { intraOpNumThreads: Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2))), interOpNumThreads: 1, executionMode: 'sequential', enableMemPattern: false },
      }),
      AutoTokenizer.from_pretrained(id, { progress_callback }),
    ]).then(([network, tokenizer]) => guardTokenWindow(new KokoroTTS(network, tokenizer)))
      .catch(error => { modelPromise = null; throw error; });
  }
  return modelPromise;
}
const queue = [];
let running = false, closing = false, active;
const priority = message => ({ interactive: 0, ahead: 1, background: 2 })[message.priority] ?? 0;
parentPort.on('message', message => {
  if (message.action === 'shutdown') {
    if (closing) return;
    closing = true;
    for (const item of queue.splice(0)) parentPort.postMessage({ id: item.id, error: 'Speech cancelled' });
    if (active) active.cancelled = true;
    if (!running) void shutdown();
    return;
  }
  if (closing) { if (message.id) parentPort.postMessage({ id: message.id, error: 'Speech cancelled' }); return; }
  if (message.action === 'cancel') {
    const index = queue.findIndex(item => item.requestId === message.requestId);
    if (index >= 0) { const [item] = queue.splice(index, 1); parentPort.postMessage({ id: item.id, error: 'Speech cancelled' }); }
    if (active?.requestId === message.requestId) active.cancelled = true;
    return;
  }
  queue.push(message);
  queue.sort((a, b) => priority(a) - priority(b));
  void drain();
});
async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const message = active = queue.shift();
    try {
      const began = performance.now();
      const tts = await model();
      const loaded = performance.now();
      if (message.cancelled) throw new Error('Speech cancelled');
      if (message.action === 'load') {
        parentPort.postMessage({ id: message.id, ready: true, result: { ready: true } }); continue;
      }
      const audio = await generateVoice(tts, message.text, message.voice, () => {
        if (message.cancelled) throw new Error('Speech cancelled');
      });
      const generated = performance.now();
      if (message.cancelled) throw new Error('Speech cancelled');
      const bytes = new Uint8Array(await new RawAudio(audio.audio, audio.sampling_rate).toBlob().arrayBuffer());
      const samples = new Float32Array(audio.audio);
      parentPort.postMessage({ id: message.id, ready: true, result: { bytes, samples, mime: 'audio/wav', sampleRate: audio.sampling_rate, timing: { loadMs: loaded - began, generateMs: generated - loaded } } }, [bytes.buffer, samples.buffer]);
    } catch (error) {
      parentPort.postMessage({ id: message.id, error: error.message || 'Voice generation failed.' });
    }
  }
  active = undefined;
  running = false;
  if (closing) await shutdown();
}
async function shutdown() {
  // Let native initialization/inference settle before releasing its sessions.
  // Terminating a worker inside an ONNX call can crash Electron during exit.
  try { const tts = await modelPromise; await tts?.model.dispose(); }
  finally { parentPort.close(); }
}
