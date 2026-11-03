import { KokoroTTS } from 'kokoro-js';
import { StyleTextToSpeech2Model, AutoTokenizer, env } from '@huggingface/transformers';
import { availableParallelism } from 'node:os';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
env.cacheDir = path.resolve('.cache/models'); env.allowRemoteModels = false;
const mode = process.argv[2] || 'default';
const options = mode === 'no-arena' ? { enableCpuMemArena: false } : mode === 'no-pattern' ? { enableMemPattern: false } : {};
const began = performance.now();
const [network, tokenizer] = await Promise.all([
  StyleTextToSpeech2Model.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'fp32', device: 'cpu', session_options: { intraOpNumThreads: Math.min(8, Math.max(1, Math.floor(availableParallelism() / 2))), interOpNumThreads: 1, executionMode: 'sequential', ...options } }),
  AutoTokenizer.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX'),
]);
const tts = new KokoroTTS(network, tokenizer);
const results = { mode, loadMs: Math.round(performance.now() - began), clips: [] };
const texts = [
  'A good story stays with you.',
  'Take a breath, settle in, and let the words come to you.',
  'People choose the most preferred bundle they can afford. A change in price moves the budget line, while a change in income shifts the opportunities available to the consumer.',
  'The market brings buyers and sellers together. Prices reflect both demand and supply, and the equilibrium changes when either side of the market changes.',
  'An ordinary day can still hold something unexpected.',
  'We can describe consumer choice by looking at preferences and the budget constraint. Together, these explain why a household chooses one particular bundle of goods.',
];
for (let cycle = 0; cycle < 3; cycle++) for (const text of texts) {
  const start = performance.now();
  const audio = await tts.generate(text, { voice: 'af_heart' });
  results.clips.push({ cycle, characters: text.length, ms: Math.round(performance.now() - start), seconds: audio.audio.length / audio.sampling_rate, rssMB: Math.round(process.memoryUsage().rss / 1048576) });
}
results.finalMB = Math.round(process.memoryUsage().rss / 1048576);
results.meanMs = Math.round(results.clips.slice(6).reduce((n, item) => n + item.ms, 0) / 12);
console.log(JSON.stringify(results));
await writeFile(`test-results/model-memory-${mode}.json`, JSON.stringify(results, null, 2));
await network.dispose();
