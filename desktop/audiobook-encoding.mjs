import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, stat, readdir, unlink, rmdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, setPriority } from 'node:os';
import path from 'node:path';
import { ffmpegProgress } from './export-encoding.mjs';

const rate = 24000, frame = 1024, context = 6 * frame;
const section = Math.floor(120 * rate / frame) * frame;
const format = 'aac-twoloop-96k-24k-mono-context6-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fileHash(filename, start, end) {
  const digest = createHash('sha256');
  for await (const bytes of createReadStream(filename, start === undefined ? {} : { start, end: end - 1 })) digest.update(bytes);
  return digest.digest('hex');
}
export function aacFrames(bytes) {
  const frames = []; let at = 0;
  while (at < bytes.length) {
    if (at + 7 > bytes.length || bytes[at] !== 255 || (bytes[at + 1] & 246) !== 240 || bytes[at + 2] >> 6 !== 1 || (bytes[at + 2] >> 2 & 15) !== 6 || ((bytes[at + 2] & 1) << 2 | bytes[at + 3] >> 6) !== 1 || (bytes[at + 6] & 3)) throw new Error('The compressed audio section has an invalid AAC header.');
    const size = (bytes[at + 3] & 3) << 11 | bytes[at + 4] << 3 | bytes[at + 5] >> 5;
    if (size < (bytes[at + 1] & 1 ? 7 : 9) || at + size > bytes.length) throw new Error('The compressed audio section is incomplete.');
    frames.push(bytes.subarray(at, at + size)); at += size;
  }
  return frames;
}
export function aacTiming(samples) {
  if (!Number.isSafeInteger(samples) || samples <= 0) throw new Error('Invalid audio duration.');
  const last = Math.ceil(samples / frame), tail = samples % frame || frame;
  // Keep one global priming frame. Internal sections contain neither priming nor trailing padding.
  return `aac_adtstoasc,setts=pts=(N*1024-1024)/24000/TB:dts=(N*1024-1024)/24000/TB:duration=if(eq(N\\,${last})\\,${tail}\\,1024)/24000/TB`;
}
async function run(command, args, { onChild = () => {}, onData, input } = {}) {
  const child = spawn(command, args, { windowsHide: true, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  let error = '', inputError;
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`Audio encoding stopped (${code}). ${error}`)));
  });
  child.stdout.on('data', data => onData?.(data)); child.stderr.on('data', data => error = (error + data).slice(-4000));
  try { if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* Encoding still stays in a separate bounded process. */ }
  onChild(child);
  const feeding = input ? pipeline(Readable.from(input), child.stdin).catch(reason => { inputError = reason; child.kill(); }) : Promise.resolve();
  try { await closed; await feeding; if (inputError) throw inputError; }
  finally { await feeding; onChild(null); }
}
export class BackgroundEncoding {
  constructor({ directory, pcmPath, ffmpeg, sourceHash, modelIdentity, atomicJson, onProgress = () => {}, onChild = () => {}, cancelled = () => false }) {
    Object.assign(this, { directory: path.join(directory, 'encoding'), pcmPath, ffmpeg, sourceHash, modelIdentity, atomicJson, onProgress, onChild, cancelled });
    this.parts = []; this.completed = 0; this.available = 0; this.final = false; this.stopped = false; this.pending = null; this.error = null; this.child = null;
  }
  name(index, extension) { return path.join(this.directory, `part-${String(index).padStart(8, '0')}.${extension}`); }
  check() { if (this.error) throw this.error; if (this.stopped || this.cancelled()) throw new Error('Export paused.'); }
  async restore(samples) {
    await mkdir(this.directory, { recursive: true });
    this.identity = hash(JSON.stringify([format, this.sourceHash, this.modelIdentity, await fileHash(this.ffmpeg)]));
    for (let index = 0; ; index++) {
      this.check(); let item;
      try {
        const metadata = await stat(this.name(index, 'json')); if (metadata.size > 4096) break;
        item = JSON.parse(await readFile(this.name(index, 'json'), 'utf8'));
        if (item.version !== 1 || item.identity !== this.identity || item.start !== this.completed || !Number.isSafeInteger(item.end) || item.end <= item.start || item.end > samples || item.start % frame || (item.end % frame && item.end !== samples) || item.end - item.start > section || item.frames !== Math.ceil((item.end - item.start) / frame) + (item.start ? 0 : 1) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !/^[a-f0-9]{64}$/.test(item.hash) || !/^[a-f0-9]{64}$/.test(item.pcmHash)) break;
        if (await fileHash(this.pcmPath, item.start * 2, item.end * 2) !== item.pcmHash) throw Object.assign(new Error('Saved narration changed. Keep the job files; the completed compressed sections have been retained.'), { code: 'CADENCE_PCM_CHANGED' });
        const filename = this.name(index, 'aac'), size = await stat(filename);
        if (size.size !== item.bytes || size.size > 16 * 1024 * 1024 || await fileHash(filename) !== item.hash) break;
        const frames = aacFrames(await readFile(filename)); if (frames.length !== item.frames) break;
      } catch (error) { if (error.code && error.code !== 'ENOENT') throw error; break; }
      this.parts.push(item); this.completed = item.end;
    }
    this.available = samples; this.onProgress(this.completed, this.completed); return this;
  }
  update(samples) {
    this.check(); this.available = samples;
    if (!this.pending) {
      this.pending = this.work().catch(error => { this.error = error; }).finally(() => { this.pending = null; });
    }
  }
  async boundary(target) {
    // Prefer a quiet frame near the target so codec-state changes fall in breathing room.
    const start = Math.max(this.completed + frame, target - 10 * rate), aligned = Math.ceil(start / frame) * frame;
    const before = Math.max(0, aligned - context), after = Math.min(this.available, target + context);
    const bytes = Buffer.alloc((after - before) * 2), file = await open(this.pcmPath, 'r');
    try { const result = await file.read(bytes, 0, bytes.length, before * 2); if (result.bytesRead !== bytes.length) throw new Error('Saved narration is incomplete.'); } finally { await file.close(); }
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2), energies = new Float64Array(samples.length + 1);
    for (let i = 0; i < samples.length; i++) energies[i + 1] = energies[i] + samples[i] * samples[i];
    let best = target, lowest = Infinity;
    for (let end = target; end >= aligned; end -= frame) {
      const left = Math.max(0, end - before - context), right = Math.min(samples.length, end - before + context);
      const energy = (energies[right] - energies[left]) / Math.max(1, right - left);
      if (energy < lowest) { lowest = energy; best = end; }
      if (energy < 16) break;
    }
    return best;
  }
  async work() {
    while (true) {
      this.check(); const remaining = this.available - this.completed;
      if (!remaining || !this.final && remaining < section + context) return;
      const target = this.completed + section;
      const end = remaining > section ? await this.boundary(target) : this.available;
      await this.encode(end);
    }
  }
  async encode(end) {
    this.check(); const start = this.completed, before = Math.min(start, context), after = Math.min(this.available - end, context), index = this.parts.length;
    const raw = this.name(index, 'encoder.tmp'), temporary = this.name(index, 'aac.tmp');
    const child = value => { this.child = value; this.onChild(value); if (value && (this.stopped || this.cancelled())) value.kill(); };
    await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats', '-stats_period', '1', '-progress', 'pipe:1', '-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-skip_initial_bytes', String((start - before) * 2), '-i', this.pcmPath, '-t', String((before + end - start + after) / rate), '-c:a', 'aac', '-aac_coder', 'twoloop', '-b:a', '96k', '-f', 'adts', raw], { onChild: child, onData: ffmpegProgress(record => this.onProgress(this.completed, Math.max(start, Math.min(end, start + Math.round(record.seconds * rate) - before)))) });
    this.check(); const size = await stat(raw); if (size.size > 16 * 1024 * 1024) throw new Error('The compressed audio section is too large.');
    const frames = aacFrames(await readFile(raw)), skip = start ? 1 + before / frame : 0, count = Math.ceil((end - start) / frame) + (start ? 0 : 1);
    if (frames.length < skip + count) throw new Error('The encoder returned an incomplete audio section.');
    const bytes = Buffer.concat(frames.slice(skip, skip + count)), file = await open(temporary, 'w');
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    const item = { version: 1, identity: this.identity, start, end, frames: count, bytes: bytes.length, hash: hash(bytes), pcmHash: await fileHash(this.pcmPath, start * 2, end * 2) };
    this.check(); await rename(temporary, this.name(index, 'aac')); await this.atomicJson(this.name(index, 'json'), item);
    this.parts.push(item); this.completed = end; await unlink(raw); this.onProgress(end, end);
  }
  async finish(samples) {
    this.final = true; this.update(samples);
    while (this.pending) { await this.pending; this.check(); if (this.completed < samples) this.update(samples); }
    this.check(); if (this.completed !== samples) throw new Error('The saved audio sections do not cover the complete narration.');
  }
  async assemble(metadata, output, onData) {
    this.check(); const self = this;
    async function* input() { for (let i = 0; i < self.parts.length; i++) { self.check(); for await (const bytes of createReadStream(self.name(i, 'aac'))) { self.check(); yield bytes; } } }
    await run(this.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats', '-stats_period', '1', '-progress', 'pipe:1', '-y', '-f', 'aac', '-i', 'pipe:0', '-f', 'ffmetadata', '-i', metadata, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'copy', '-bsf:a', aacTiming(this.completed), '-use_editlist', '1', '-movie_timescale', String(rate), '-movflags', '+faststart', '-f', 'mp4', output], { input: input(), onData, onChild: value => { this.child = value; this.onChild(value); if (value && (this.stopped || this.cancelled())) value.kill(); } });
    this.check();
  }
  async stop() { this.stopped = true; this.child?.kill(); await this.pending; }
}
export async function cleanupEncoding(directory) {
  const folder = path.join(directory, 'encoding');
  let names; try { names = await readdir(folder); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const name of names) if (/^part-\d{8}\.(aac|json|aac\.tmp|json\.tmp|encoder\.tmp)$/.test(name)) await unlink(path.join(folder, name)).catch(() => {});
  await rmdir(folder).catch(() => {});
}
