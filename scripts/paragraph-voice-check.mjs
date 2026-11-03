import { Worker } from 'node:worker_threads';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pdfParagraphs } from '../src/paragraphs.ts';
const fixture = JSON.parse(await readFile('test-results/paragraph-source.json', 'utf8'));
const paragraphs = pdfParagraphs(fixture.items, fixture.page);
const paragraph = paragraphs.find(item => item.text.includes('formal education'));
assert.ok(paragraph.text.includes('ethical homilies.'));
assert.ok(paragraph.text.includes('encouraged reading and gave'));
console.log(`PASS Actual book page ${fixture.page}: ${paragraphs.length} paragraphs; split screenshot sentence and wrapped short line repaired.`);
const worker = new Worker(new URL('../desktop/speech-worker.mjs', import.meta.url), { workerData: { cacheDir: path.resolve('.cache/models'), offline: true } });
let id = 0;
const requests = new Map();
worker.on('message', message => {
  if (message.type === 'progress') return;
  const request = requests.get(message.id); requests.delete(message.id);
  if (message.error) request.reject(new Error(message.error)); else request.resolve(message.result);
});
worker.on('error', error => { for (const request of requests.values()) request.reject(error); });
function ask(action, data = {}) { return new Promise((resolve, reject) => { const requestId = ++id; requests.set(requestId, { resolve, reject }); worker.postMessage({ id: requestId, action, ...data }); }); }
try {
  await mkdir('test-results/audio', { recursive: true });
  await ask('load');
  const sentence = paragraph.text.slice(0, paragraph.text.indexOf('homilies.') + 'homilies.'.length);
  const long = 'The thoughtful reader considers ' + 'many important ideas about science and history, '.repeat(16) + 'and reaches the final conclusion.';
  const results = [];
  for (const [name, text] of [['complete-sentence', sentence], ['oversized-sentence', long]]) {
    const result = await ask('generate', { text, voice: 'af_heart' });
    const bytes = Buffer.from(result.bytes);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.ok(result.samples.length > 24000);
    const item = { name, characters: text.length, audioSeconds: result.samples.length / result.sampleRate, generationMs: Math.round(result.timing.generateMs) };
    if (name === 'oversized-sentence') assert.ok(item.audioSeconds > 35);
    await writeFile(`test-results/audio/${name}.wav`, bytes);
    results.push(item); console.log(JSON.stringify(item));
  }
  await writeFile('test-results/paragraph-voice-results.json', JSON.stringify(results, null, 2));
} finally { await worker.terminate(); }
