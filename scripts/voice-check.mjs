import { Worker } from 'node:worker_threads';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
await mkdir('test-results/audio', { recursive: true });
await mkdir('.cache/models', { recursive: true });
await copyFile(new URL('../node_modules/kokoro-js/LICENSE', import.meta.url), '.cache/models/LICENSE-KOKORO.txt');
const worker = new Worker(new URL('../desktop/speech-worker.mjs', import.meta.url), { workerData: { cacheDir: path.resolve('.cache/models') } });
let id = 0;
const requests = new Map();
let lastProgress = 0;
worker.on('message', message => {
  if (message.type === 'progress') {
    if (message.progress.status === 'progress' && Date.now() - lastProgress > 5000) { console.log(`Model download: ${Math.round(message.progress.progress)}%`); lastProgress = Date.now(); }
    return;
  }
  const request = requests.get(message.id);
  requests.delete(message.id);
  if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
});
worker.on('error', error => { for (const request of requests.values()) request.reject(error); });
function ask(action, request = {}) { return new Promise((resolve, reject) => { const requestId = ++id; requests.set(requestId, { resolve, reject }); worker.postMessage({ id: requestId, action, ...request }); }); }
try {
  const start = Date.now();
  await ask('load');
  console.log(`Model initialized in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  const results = [];
  for (const voice of ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'am_michael', 'am_fenrir', 'bf_emma', 'bm_george']) {
    const time = Date.now();
    const result = await ask('generate', { text: 'A good story stays with you. Take a breath, settle in, and let the words come to you.', voice });
    const bytes = Buffer.from(result.bytes);
    if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.length < 24000) throw new Error(`Invalid audio for ${voice}`);
    await writeFile(`test-results/audio/${voice}.wav`, bytes);
    const entry = { voice, seconds: +((bytes.length - 44) / 48000).toFixed(2), generationSeconds: +((Date.now() - time) / 1000).toFixed(2), bytes: bytes.length };
    results.push(entry); console.log(JSON.stringify(entry));
  }
  await writeFile('test-results/audio/results.json', JSON.stringify(results, null, 2));
} finally { await worker.terminate(); }
