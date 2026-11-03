import { KokoroTTS } from 'kokoro-js';
import { StyleTextToSpeech2Model, AutoTokenizer, env } from '@huggingface/transformers';
import { writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
env.cacheDir = path.resolve('.cache/models');
env.allowRemoteModels = process.argv.includes('--download');
const results = [];
const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const tokenizer = await AutoTokenizer.from_pretrained(modelId);
const device = process.argv.includes('--gpu') ? 'dml' : 'cpu';
const dtype = process.argv.includes('--fp32') ? 'fp32' : 'q8';
for (const threads of (device === 'dml' ? [4] : [4, 6, 8])) {
  const start = performance.now();
  const model = await StyleTextToSpeech2Model.from_pretrained(modelId, {
    dtype, device,
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1, executionMode: 'sequential', ...(device === 'dml' ? { enableMemPattern: false } : {}) },
  });
  const tts = new KokoroTTS(model, tokenizer);
  const entry = { threads, loadMs: Math.round(performance.now() - start), clips: [] };
  for (const text of [
    'A good story stays with you.',
    'Take a breath, settle in, and let the words come to you.',
    'Take a breath, settle in, and let the words come to you.',
  ]) {
    const at = performance.now();
    const audio = await tts.generate(text, { voice: 'af_heart' });
    entry.clips.push({ characters: text.length, generateMs: Math.round(performance.now() - at), audioSeconds: audio.audio.length / audio.sampling_rate });
  }
  console.log(JSON.stringify(entry)); results.push(entry);
  await model.dispose();
}
await mkdir('test-results', { recursive: true });
await writeFile(`test-results/latency-benchmark-${device}-${dtype}.json`, JSON.stringify({ cpu: os.cpus()[0].model, logicalCores: os.cpus().length, results }, null, 2));
