import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createExportBackend } from '../desktop/audiobook-backend.mjs';
import { exportSource, speechClipBounds, pcm16, wavBytes } from '../desktop/export-core.mjs';
const option = name => process.argv[process.argv.indexOf(name) + 1];
const engine = process.argv.includes('--engine') ? option('--engine') : 'kokoro-cuda';
if (!['kokoro-cuda', 'kokoro-cpu'].includes(engine)) throw new Error('Choose kokoro-cuda or kokoro-cpu. Qwen was removed.');
const voice = process.argv.includes('--voice') ? option('--voice') : 'af_heart';
const output = path.resolve('test-results/audiobook'), modelRoot = path.resolve('.cache/models'); await mkdir(output, { recursive: true });
const paragraphs = [
  'A quiet beginning',
  'The first light reached the window before the town began to stir. Across the square, a shopkeeper opened the shutters and placed a small wooden chair beside the door. Nothing remarkable had happened, yet the morning already felt different.',
  'At half past seven, three travellers arrived with a map, two notebooks, and a question about the road beyond the river. They had walked twelve kilometres through the night. Now they wanted a warm breakfast and a reliable answer.',
  'The shopkeeper listened carefully, then pointed to a narrow lane behind the old stone bridge. “Follow that lane until you reach the orchard,” she said. “If the gate is closed, ask for Anna; she knows the way.”',
  'A different perspective',
  'Good decisions often begin with patient observation. A useful explanation connects evidence with consequences, considers several possibilities, and leaves room for uncertainty. The most confident answer is not always the most accurate one.',
  'The travellers agreed to compare their notes before setting out again. Each had noticed something different along the same road: a broken sign, the sound of running water, or a light in a distant house. Together, those details made the journey easier to understand.',
];
const source = exportSource({ kind: 'NOTE', segments: paragraphs.map((text, i) => ({ text, page: 1, heading: i === 0 || i === 4 })) });
const began = performance.now(), backend = await createExportBackend({ engine, runtimeRoot: path.resolve('.cache/audiobook'), modelRoot }), loaded = performance.now(), clips = [], samples = [];
console.log(JSON.stringify({ engine, voice, loadMs: loaded - began, details: backend.details }));
try {
  for (let i = 0, current; (current = source.get(i)); i++) {
    const start = performance.now(), audio = await backend.generate(current.text, voice), next = source.get(i + 1), bounds = speechClipBounds(audio.audio, audio.sampling_rate, current, next);
    const pcm = pcm16(audio.audio, Math.round(bounds.offset * audio.sampling_rate), Math.min(audio.audio.length, Math.round((bounds.offset + bounds.duration) * audio.sampling_rate)));
    samples.push(pcm); clips.push({ text: current.text, generationMs: performance.now() - start, seconds: pcm.length / 24000 }); source.release(i + 1);
    console.log(JSON.stringify({ clip: i, ...clips.at(-1) }));
  }
  const generated = performance.now(), total = samples.reduce((sum, chunk) => sum + chunk.length, 0), joined = new Float32Array(total); let at = 0;
  for (const chunk of samples) { for (const sample of chunk) joined[at++] = sample / 32768; }
  await writeFile(path.join(output, `${engine}-${voice}.wav`), wavBytes(joined, 24000));
  const report = { engine, voice, details: backend.details, loadMs: loaded - began, generationMs: generated - loaded, audioSeconds: total / 24000, timesRealtime: total / 24000 / ((generated - loaded) / 1000), projectedOneHourMinutes: (generated - loaded) / (total / 24000) * .06, rms: Math.sqrt(joined.reduce((sum, sample) => sum + sample * sample, 0) / joined.length), clips, modelSha256: createHash('sha256').update(await readFile(path.join(modelRoot, 'onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx'))).digest('hex') };
  await writeFile(path.join(output, `${engine}-${voice}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, clips: undefined }, null, 2));
} catch (error) { await writeFile(path.join(output, `${engine}-${voice}-error.json`), JSON.stringify({ error: error.message, detail: error.detail }, null, 2)); console.error(error.message, error.detail); process.exitCode = 1; }
finally { await backend.close(); }
