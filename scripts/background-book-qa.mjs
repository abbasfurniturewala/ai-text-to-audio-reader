import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { BackgroundEncoding } from '../desktop/audiobook-encoding.mjs';
import { atomicJson, chapterMetadata } from '../desktop/audiobook-jobs.mjs';
import { runtimeConfiguration } from '../desktop/audiobook-backend.mjs';
const supplied = process.argv[process.argv.indexOf('--snapshot') + 1];
if (!process.argv.includes('--snapshot') || !supplied) throw new Error('Provide an isolated --snapshot containing job.json and audio.pcm.');
const snapshot = await realpath(supplied), relative = path.relative(process.cwd(), snapshot);
if (relative.startsWith('..') || path.isAbsolute(relative) || !/^(?:\.cache|test-results)[\\/]/.test(relative)) throw new Error('The snapshot must be inside this workspace’s .cache or test-results, never a live profile.');
const job = JSON.parse(await readFile(path.join(snapshot, 'job.json'), 'utf8')), pcmPath = path.join(snapshot, 'audio.pcm'); assert.equal((await stat(pcmPath)).size, job.samples * 2);
const config = await runtimeConfiguration(path.resolve('.cache/audiobook')), directory = path.resolve('test-results/background-encoding/book-' + Date.now()); await mkdir(directory, { recursive: true });
const metadata = path.join(directory, 'chapters.txt'), output = path.join(directory, 'book.m4b'); await writeFile(metadata, chapterMetadata(job));
const codeHash = createHash('sha256').update(await readFile('desktop/audiobook-encoding.mjs')).digest('hex'), began = performance.now(); let peakHeap = 0, peakRss = 0, last = 0;
const timer = setInterval(() => { peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed); peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 100);
const options = { directory, pcmPath, ffmpeg: config.ffmpeg, sourceHash: job.sourceHash, modelIdentity: job.modelIdentity, atomicJson };
let worker, report = { directory, codeHash, samples: job.samples, chapters: job.chapters.length };
try {
  worker = new BackgroundEncoding({ ...options, onProgress: (saved, current) => { if (performance.now() - last < 30000) return; last = performance.now(); console.log(JSON.stringify({ stage: 'compressing', savedSeconds: saved / 24000, currentSeconds: current / 24000, elapsedSeconds: (last - began) / 1000 })); } });
  await worker.restore(job.samples); await worker.finish(job.samples); report.compressionSeconds = (performance.now() - began) / 1000; report.sections = worker.parts.length;
  const first = await stat(worker.name(0, 'aac')); await worker.stop();
  const resumeBegan = performance.now(); worker = new BackgroundEncoding(options); await worker.restore(job.samples); assert.equal(worker.completed, job.samples); await worker.finish(job.samples); assert.equal((await stat(worker.name(0, 'aac'))).mtimeMs, first.mtimeMs); report.restorationSeconds = (performance.now() - resumeBegan) / 1000;
  const assemblyBegan = performance.now(); await worker.assemble(metadata, output); report.assemblySeconds = (performance.now() - assemblyBegan) / 1000; await worker.stop();
  const info = await new Promise((resolve, reject) => { const child = spawn(config.ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', output], { windowsHide: true }); let text = '', error = ''; child.stdout.on('data', data => text += data); child.stderr.on('data', data => error += data); child.on('error', reject); child.on('close', code => code ? reject(new Error(error)) : resolve(JSON.parse(text))); });
  assert.equal(Number(info.streams[0].duration_ts), job.samples); assert.equal(info.streams[0].sample_rate, '24000'); assert.equal(info.chapters.length, job.chapters.length);
  for (let i = 0; i < job.chapters.length; i++) { assert.equal(info.chapters[i].tags.title, job.chapters[i].title); assert(Math.abs(Number(info.chapters[i].start_time) - job.chapters[i].sample / 24000) < .002); }
  const decodeBegan = performance.now(); let decodedBytes = 0;
  await new Promise((resolve, reject) => { const child = spawn(config.ffmpeg, ['-v', 'error', '-nostdin', '-i', output, '-map', '0:a:0', '-f', 's16le', '-ar', '24000', '-ac', '1', 'pipe:1'], { windowsHide: true }); let error = ''; child.stdout.on('data', data => decodedBytes += data.length); child.stderr.on('data', data => error += data); child.on('error', reject); child.on('close', code => code || error ? reject(new Error(error)) : resolve()); });
  assert.equal(decodedBytes, job.samples * 2); report.decodeSeconds = (performance.now() - decodeBegan) / 1000; report.decodedSamples = decodedBytes / 2; report.bytes = (await stat(output)).size;
  const hash = createHash('sha256'); for await (const bytes of createReadStream(output)) hash.update(bytes); report.sha256 = hash.digest('hex'); report.passed = true;
  await writeFile(path.join(directory, 'probe.json'), JSON.stringify(info, null, 2));
} catch (error) { report.error = error.stack; process.exitCode = 1; console.error(error); }
finally { clearInterval(timer); await worker?.stop(); Object.assign(report, { peakHeap, peakRss, totalSeconds: (performance.now() - began) / 1000, liveProfileAccess: false, narrationPlayed: false }); await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); }
