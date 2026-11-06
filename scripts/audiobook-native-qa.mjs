import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { AudiobookJobs, atomicJson } from '../desktop/audiobook-jobs.mjs';
import { runtimeConfiguration } from '../desktop/audiobook-backend.mjs';
const output = path.resolve('test-results/audiobook/native-' + Date.now()); await mkdir(output, { recursive: true });
const config = await runtimeConfiguration(path.resolve('.cache/audiobook')), checks = [], errors = [];
const base = { root: path.join(output, 'jobs'), runtimeRoot: path.resolve('.cache/audiobook'), modelRoot: path.resolve('.cache/models') };
const text = ['An opening', 'The first light reached the window before the town began to stir. Across the square, a shopkeeper opened the shutters and placed a small wooden chair beside the door.', 'Another chapter', 'Good decisions often begin with patient observation. A useful explanation connects evidence with consequences, considers several possibilities, and leaves room for uncertainty.'];
const request = { document: { id: 'native-qa', title: 'Offline audiobook fixture', kind: 'EPUB', pageCount: 2, segments: text.map((text, i) => ({ text, page: i < 2 ? 1 : 2, heading: i % 2 === 0 })), topics: [{ title: 'An opening', page: 1, segment: 0 }, { title: 'Another chapter', page: 2, segment: 2 }] }, from: 0, engine: 'kokoro-cuda', voice: 'af_heart', voiceName: 'Heart' };
const probe = filename => new Promise((resolve, reject) => { const child = spawn(config.ffprobe, ['-v', 'error', '-show_format', '-show_chapters', '-show_streams', '-of', 'json', filename], { windowsHide: true }); let output = ''; child.stdout.on('data', data => output += data); child.on('error', reject); child.on('exit', code => code ? reject(new Error('ffprobe failed')) : resolve(JSON.parse(output))); });
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
try {
  await check('Real offline CUDA Kokoro saves a chaptered AAC M4B and releases its temporary audio', async () => {
    const jobs = new AudiobookJobs(base), job = await jobs.create(request, path.join(output, 'gpu.m4b')), result = await jobs.start(job.id); assert.equal(result.status, 'complete', result.message);
    const info = await probe(result.output); assert(info.streams.some(stream => stream.codec_name === 'aac')); assert.deepEqual(info.chapters.map(item => item.tags.title), ['An opening', 'Another chapter']); assert(Number(info.format.duration) > 20);
    await assert.rejects(stat(path.join(base.root, job.id, 'audio.pcm'))); await assert.rejects(stat(path.join(base.root, job.id, 'source.json'))); await writeFile(path.join(output, 'gpu-probe.json'), JSON.stringify(info, null, 2));
  });
  await check('CPU fallback produces the same source chapters without a GPU helper', async () => {
    const jobs = new AudiobookJobs(base), job = await jobs.create({ ...request, engine: 'kokoro-cpu' }, path.join(output, 'cpu.m4b')), result = await jobs.start(job.id); assert.equal(result.status, 'complete', result.message);
    const info = await probe(result.output); assert.deepEqual(info.chapters.map(item => item.tags.title), ['An opening', 'Another chapter']); await writeFile(path.join(output, 'cpu-probe.json'), JSON.stringify(info, null, 2));
  });
  await check('Two-hour-five-minute synthetic output has valid chapters and bounded working memory', async () => {
    const doc = { ...request.document, id: 'long-qa', title: '125-minute synthetic duration fixture', pageCount: 100, segments: Array.from({ length: 100 }, (_, i) => ({ text: `Passage ${i + 1} has a sufficiently long complete sentence for an isolated synthetic duration test.`, page: i + 1, heading: false })), topics: [{ title: 'Beginning', page: 1, segment: 0 }, { title: 'After an hour', page: 51, segment: 50 }, { title: 'Past the old two-hour cap', page: 98, segment: 97 }] };
    let peakRss = process.memoryUsage().rss, peakHeap = process.memoryUsage().heapUsed; const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); }, 20);
    try {
      const jobs = new AudiobookJobs({ ...base, configuration: config, backendFactory: async () => ({ details: { device: 'synthetic silence fixture' }, generate: async () => ({ audio: new Float32Array(24000 * 75), sampling_rate: 24000 }), close: async () => {} }) });
      const job = await jobs.create({ ...request, document: doc }, path.join(output, '125-minutes.m4b')), result = await jobs.start(job.id); assert.equal(result.status, 'complete', result.message);
      const info = await probe(result.output); assert(Math.abs(Number(info.format.duration) - 7500) < .1); assert.equal(info.chapters.length, 3); assert(Number(info.chapters[2].start_time) > 7200); assert(peakHeap < 200 * 1024 * 1024); await writeFile(path.join(output, 'long-probe.json'), JSON.stringify({ info, peakRss, peakHeap }, null, 2));
    } finally { clearInterval(timer); }
  });
  await check('A crash after publishing is recovered without synthesis or replacing the finished file', async () => {
    const jobs = new AudiobookJobs({ ...base, configuration: config, backendFactory: async () => { throw new Error('Recovery must not load a model'); } }), job = await jobs.create(request, path.join(output, 'crash-recovery.m4b'));
    const bytes = await readFile(path.join(output, 'gpu.m4b')); await writeFile(job.output, bytes);
    const filename = path.join(base.root, job.id, 'job.json'), checkpoint = JSON.parse(await readFile(filename, 'utf8')); checkpoint.finishedHash = createHash('sha256').update(bytes).digest('hex'); checkpoint.status = 'encoding'; await atomicJson(filename, checkpoint);
    const result = await jobs.start(job.id); assert.equal(result.status, 'complete'); assert.deepEqual(await readFile(job.output), bytes);
  });
} catch (error) { errors.push(error.stack); process.exitCode = 1; console.error(error); }
finally { await writeFile(path.join(output, 'report.json'), JSON.stringify({ checks, errors, output }, null, 2)); }
