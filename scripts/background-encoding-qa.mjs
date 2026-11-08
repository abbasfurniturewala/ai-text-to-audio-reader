import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, stat, open } from 'node:fs/promises';
import { constants, getPriority } from 'node:os';
import path from 'node:path';
import { BackgroundEncoding, aacFrames } from '../desktop/audiobook-encoding.mjs';
import { AudiobookJobs, atomicJson, chapterMetadata } from '../desktop/audiobook-jobs.mjs';
import { runtimeConfiguration } from '../desktop/audiobook-backend.mjs';

const config = await runtimeConfiguration(path.resolve('.cache/audiobook'));
const output = path.resolve('test-results/background-encoding/native-' + Date.now()); await mkdir(output, { recursive: true });
const checks = [], errors = [], details = {}, samples = 24000 * 251 + 17;
const pcm = path.join(output, 'fixture.pcm'), metadata = path.join(output, 'chapters.txt');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function run(exe, args) {
  return new Promise((resolve, reject) => { const child = spawn(exe, args, { windowsHide: true }); const blocks = []; let error = ''; child.stdout.on('data', data => blocks.push(data)); child.stderr.on('data', data => error += data); child.on('error', reject); child.on('close', code => code ? reject(new Error(error)) : resolve(Buffer.concat(blocks))); });
}
const probe = async filename => JSON.parse((await run(config.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', filename])).toString());
const decode = filename => run(config.ffmpeg, ['-v', 'error', '-nostdin', '-i', filename, '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1']);
async function check(name, task) { await task(); checks.push(name); console.log('PASS ' + name); }
function encoder(directory, extra = {}) { return new BackgroundEncoding({ directory, pcmPath: pcm, ffmpeg: config.ffmpeg, sourceHash: 'synthetic-source-v1', modelIdentity: 'synthetic-model-v1', atomicJson, ...extra }); }
function signal(count) {
  const bytes = Buffer.alloc(count * 2);
  for (let i = 0; i < count; i++) {
    const t = i / 24000, gain = .12 * (1 - Math.cos(Math.min(1, t % 1) * Math.PI * 2)) / 2;
    bytes.writeInt16LE(Math.round(32767 * gain * (Math.sin(t * 2 * Math.PI * 197) + .35 * Math.sin(t * 2 * Math.PI * 1031) + .15 * Math.sin(t * 2 * Math.PI * 4327))), i * 2);
  }
  return bytes;
}
try {
  const bytes = signal(samples); await writeFile(pcm, bytes); await writeFile(metadata, chapterMetadata({ title: 'Section recovery fixture', voiceName: 'Synthetic', samples, chapters: [{ title: 'Opening', sample: 0 }, { title: 'A sample-exact chapter', sample: 24000 * 123 + 17 }] }));
  const directory = path.join(output, 'normal'); let firstHash, firstTime, count, completed;
  await check('Pause preserves a durable AAC prefix, restores it and does not encode it again', async () => {
    let first;
    first = encoder(directory, { onProgress: saved => { if (saved > 0) void first.stop(); } }); await first.restore(samples); await assert.rejects(first.finish(samples), /paused/); await first.stop();
    completed = first.completed; assert(completed > 0 && completed < samples);
    const filename = first.name(0, 'aac'); firstHash = hash(await readFile(filename)); firstTime = (await stat(filename)).mtimeMs;
    const resumed = encoder(directory); await resumed.restore(samples); assert.equal(resumed.completed, completed); await resumed.finish(samples); count = resumed.parts.length;
    assert.equal(hash(await readFile(filename)), firstHash); assert.equal((await stat(filename)).mtimeMs, firstTime);
    await resumed.assemble(metadata, path.join(output, 'joined.m4b')); await resumed.stop();
    details.sections = resumed.parts.map(item => ({ start: item.start, end: item.end, frames: item.frames }));
  });
  await check('Global AAC priming, every join and final padding preserve exact samples and chapter timing', async () => {
    const info = await probe(path.join(output, 'joined.m4b')), decoded = await decode(path.join(output, 'joined.m4b'));
    assert.equal(decoded.length, bytes.length); assert(Math.abs(Number(info.streams[0].duration) - samples / 24000) < 1 / 24000); assert(Math.abs(Number(info.format.duration) - samples / 24000) < .001); assert.equal(info.streams[0].sample_rate, '24000');
    assert.deepEqual(info.chapters.map(item => item.tags.title), ['Opening', 'A sample-exact chapter']); assert(Math.abs(Number(info.chapters[1].start_time) - (123 + 17 / 24000)) < .002);
    await run(config.ffmpeg, ['-v', 'error', '-nostdin', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm, '-c:a', 'aac', '-b:a', '96k', path.join(output, 'baseline.m4a')]);
    const baseline = await decode(path.join(output, 'baseline.m4a')), windows = [];
    for (const item of details.sections.slice(0, -1)) {
      const start = Math.max(0, item.end - 12000), end = Math.min(samples, item.end + 12000); let error = 0, original = 0, energy = 0, step = 0, baseStep = 0;
      for (let i = start; i < end; i++) { const raw = bytes.readInt16LE(i * 2) / 32768, joined = decoded.readInt16LE(i * 2) / 32768, base = baseline.readInt16LE(i * 2) / 32768; error += (joined - raw) ** 2; original += (base - raw) ** 2; energy += raw ** 2; if (i > start) { step = Math.max(step, Math.abs(joined - decoded.readInt16LE((i - 1) * 2) / 32768)); baseStep = Math.max(baseStep, Math.abs(base - baseline.readInt16LE((i - 1) * 2) / 32768)); } }
      const rms = Math.sqrt(error / (end - start)), baseRms = Math.sqrt(original / (end - start)); assert(rms < Math.max(.003, baseRms * 2)); assert(step < baseStep * 1.5 + .002); windows.push({ sample: item.end, rms, baselineRms: baseRms, maxStep: step, baselineMaxStep: baseStep, signalRms: Math.sqrt(energy / (end - start)) });
    }
    details.joins = windows; details.duration = info.format.duration; details.decodedSamples = decoded.length / 2;
  });
  await check('M4B assembly copies the saved AAC payload without another lossy encoding pass', async () => {
    const worker = encoder(directory); await worker.restore(samples); const expected = createHash('sha256');
    for (let i = 0; i < worker.parts.length; i++) for (const packet of aacFrames(await readFile(worker.name(i, 'aac')))) expected.update(packet.subarray(packet[1] & 1 ? 7 : 9));
    const actual = (await run(config.ffmpeg, ['-v', 'error', '-nostdin', '-i', path.join(output, 'joined.m4b'), '-map', '0:a:0', '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', 'pipe:1'])).toString().trim();
    assert.equal(actual, 'SHA256=' + expected.digest('hex')); await worker.stop();
  });
  await check('A truncated compressed section rebuilds only its suffix and retains the good prefix', async () => {
    const damaged = encoder(directory); await damaged.restore(samples); assert(count >= 3); const filename = damaged.name(1, 'aac'); await writeFile(filename, (await readFile(filename)).subarray(0, 50));
    const resumed = encoder(directory); await resumed.restore(samples); assert.equal(resumed.completed, completed); assert.equal(resumed.parts.length, 1); await resumed.finish(samples);
    assert.equal(hash(await readFile(resumed.name(0, 'aac'))), firstHash); assert.equal((await stat(resumed.name(0, 'aac'))).mtimeMs, firstTime); await resumed.stop();
  });
  await check('Malformed metadata, unfinished output and changed PCM cannot be mistaken for saved valid work', async () => {
    const saved = encoder(directory); await saved.restore(samples); await writeFile(saved.name(1, 'json'), '{interrupted'); await writeFile(saved.name(1, 'encoder.tmp'), 'incomplete');
    const resumed = encoder(directory); await resumed.restore(samples); assert.equal(resumed.parts.length, 1); await resumed.finish(samples); await resumed.stop();
    const file = await open(pcm, 'r+'); try { await file.write(Buffer.from([127, 127]), 0, 2, 0); } finally { await file.close(); }
    const changed = encoder(directory); await assert.rejects(changed.restore(samples), /Saved narration changed/); assert.equal(hash(await readFile(changed.name(0, 'aac'))), firstHash); await changed.stop(); await writeFile(pcm, bytes);
    const different = encoder(directory, { modelIdentity: 'changed-model' }); await different.restore(samples); assert.equal(different.completed, 0); await different.stop();
  });
  await check('Background compression advances before finalization, stays below normal priority and keeps memory bounded', async () => {
    let peakHeap = 0, peakRss = 0; const priorities = [];
    const worker = encoder(path.join(output, 'background'), { onChild: child => { if (child?.pid) try { priorities.push(getPriority(child.pid)); } catch {} } }); await worker.restore(0);
    const timer = setInterval(() => { const memory = process.memoryUsage(); peakHeap = Math.max(peakHeap, memory.heapUsed); peakRss = Math.max(peakRss, memory.rss); }, 20);
    try { worker.update(24000 * 180); while (worker.pending) await worker.pending; worker.check(); assert(worker.completed > 0 && worker.completed < 24000 * 180); assert.equal(worker.final, false); await worker.finish(samples); }
    finally { clearInterval(timer); await worker.stop(); }
    assert(peakHeap < 180 * 1024 * 1024); assert(priorities.length > 0 && priorities.every(value => value === constants.priority.PRIORITY_BELOW_NORMAL)); details.memory = { peakHeap, peakRss, priorities };
  });
  await check('Interrupted assembly retries keep the completed AAC cache intact', async () => {
    const worker = encoder(directory); await worker.restore(samples); const before = worker.parts.map(item => item.hash); const destination = path.join(output, 'retry.m4b');
    worker.onChild = child => { if (child) { worker.stopped = true; child.kill(); } }; await assert.rejects(worker.assemble(metadata, destination)); await worker.stop();
    const resumed = encoder(directory); await resumed.restore(samples); assert.deepEqual(resumed.parts.map(item => item.hash), before); await resumed.assemble(metadata, destination); assert.equal((await decode(destination)).length, bytes.length); await resumed.stop();
  });
  await check('A background encoder failure retains all committed speech and retry does not synthesize it again', async () => {
    const root = path.join(output, 'failure-jobs'), request = { document: { id: 'failure-fixture', title: 'Encoder failure fixture', kind: 'NOTE', pageCount: 1, segments: ['One', 'Two', 'Three'].map(word => ({ text: `${word} is a complete isolated test sentence with enough words to make its own speech unit.`, page: 1, heading: false })) }, from: 0, engine: 'kokoro-cuda', voice: 'af_heart', voiceName: 'Heart' };
    const backendFactory = async () => ({ details: { device: 'Synthetic' }, generate: async () => ({ audio: new Float32Array(24000 * 75), sampling_rate: 24000 }), close: async () => {} });
    const jobs = new AudiobookJobs({ root, configuration: { ...config, ffmpeg: process.execPath }, backendFactory }); const created = await jobs.create(request, path.join(output, 'retried-job.m4b')), failed = await jobs.start(created.id);
    assert.equal(failed.status, 'error'); assert.match(failed.message, /encoding stopped/); assert(failed.samples > 0); assert.equal((await stat(path.join(root, created.id, 'audio.pcm'))).size, failed.samples * 2);
    const calls = [], retry = new AudiobookJobs({ root, configuration: config, backendFactory: async () => ({ ...(await backendFactory()), generate: async text => { calls.push(text); return { audio: new Float32Array(24000 * 75), sampling_rate: 24000 }; } }) });
    const completed = await retry.start(created.id); assert.equal(completed.status, 'complete', completed.message); assert.equal(calls.length, 3 - failed.next); assert.equal(completed.next, 3);
    assert.equal((await decode(completed.output)).length, completed.samples * 2);
  });
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1; }
finally { await writeFile(path.join(output, 'report.json'), JSON.stringify({ output, checks, errors, details }, null, 2)); }
