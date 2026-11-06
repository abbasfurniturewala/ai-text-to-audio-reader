import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, link, copyFile, constants, statfs } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { exportSource, chapterTargets, exportOffsets, speechClipBounds, pcm16, wavBytes } from './export-core.mjs';

const engines = ['kokoro-cuda', 'kokoro-cpu'];
const rate = 24000;
export function validateExport(request) {
  const doc = request?.document;
  if (!doc || typeof doc.id !== 'string' || doc.id.length > 128 || typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > 1000 || !['PDF', 'EPUB', 'DOCX', 'TXT', 'NOTE'].includes(doc.kind)) throw new Error('Choose a valid document.');
  if (!Array.isArray(doc.segments) || !doc.segments.length || doc.segments.length > 1000000 || !Number.isSafeInteger(doc.pageCount) || doc.pageCount < 1) throw new Error('The document has no exportable text.');
  let characters = 0;
  const segments = doc.segments.map(item => {
    if (!item || typeof item.text !== 'string' || item.text.length > 1000000 || !Number.isSafeInteger(item.page) || item.page < 1 || item.page > doc.pageCount) throw new Error('Invalid document text.');
    characters += item.text.length;
    return { text: item.text, page: item.page, ...(typeof item.heading === 'boolean' ? { heading: item.heading } : {}) };
  });
  if (characters > 64 * 1024 * 1024) throw new Error('The extracted text is too large for this export.');
  let topicCount = 0;
  const topics = (items, depth = 0) => {
    if (!Array.isArray(items) || depth > 12) throw new Error('Invalid chapter hierarchy.');
    return items.map(item => {
      if (++topicCount > 20000 || !item || typeof item.title !== 'string' || item.title.length > 1000 || !Number.isInteger(item.page) || item.page < 1 || item.page > doc.pageCount) throw new Error('Invalid chapter.');
      if (item.segment !== undefined && (!Number.isInteger(item.segment) || item.segment < 0 || item.segment >= segments.length)) throw new Error('Invalid chapter passage.');
      if (item.character !== undefined && (!Number.isInteger(item.character) || item.character < 0 || item.character > (segments[item.segment]?.text.length || 1000000))) throw new Error('Invalid chapter position.');
      return { title: item.title, page: item.page, segment: item.segment, character: item.character, ...(item.children ? { children: topics(item.children, depth + 1) } : {}) };
    });
  };
  const from = request.from ?? 0;
  if (!Number.isInteger(from) || from < 0 || from >= segments.length || !engines.includes(request.engine) || typeof request.voice !== 'string' || !/^[a-zA-Z0-9_-]{2,100}$/.test(request.voice)) throw new Error('Choose valid export settings.');
  const pageLabels = doc.pageLabels;
  if (pageLabels !== undefined && (!Array.isArray(pageLabels) || pageLabels.length > doc.pageCount || pageLabels.some(label => typeof label !== 'string' || label.length > 1000))) throw new Error('Invalid page labels.');
  return { document: { id: doc.id, title: doc.title, kind: doc.kind, pageCount: doc.pageCount, segments, ...(doc.topics ? { topics: topics(doc.topics) } : {}), ...(pageLabels ? { pageLabels } : {}) }, from, engine: request.engine, voice: request.voice, voiceName: typeof request.voiceName === 'string' ? request.voiceName.slice(0, 100) : request.voice };
}
export function exportFingerprint(request) { return createHash('sha256').update(JSON.stringify(request)).digest('hex'); }
async function fileHash(filename) { const hash = createHash('sha256'); for await (const bytes of createReadStream(filename)) hash.update(bytes); return hash.digest('hex'); }
export async function atomicJson(filename, value) {
  const temporary = filename + '.tmp', file = await open(temporary, 'w');
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  // Windows scanners and readers can briefly deny replacement. Keep the old checkpoint until it succeeds.
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, filename); break; }
    catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 8) throw error; await new Promise(resolve => setTimeout(resolve, Math.min(250, 25 * 2 ** attempt))); }
  }
}
export function chapterMetadata(job) {
  const escape = text => String(text).replace(/[\r\n\x00-\x1f]+/g, ' ').replace(/[\\=;#]/g, '\\$&');
  const chapters = job.chapters.length ? job.chapters : [{ title: job.title, sample: 0 }];
  const end = Math.round(job.samples * 1000 / rate);
  return ';FFMETADATA1\ntitle=' + escape(job.title) + '\nartist=' + escape(job.voiceName) + '\n' + chapters.map((item, index) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(item.sample * 1000 / rate)}\nEND=${index + 1 < chapters.length ? Math.round(chapters[index + 1].sample * 1000 / rate) : end}\ntitle=${escape(item.title)}\n`).join('');
}
export async function publishAudio(temporary, destination, { id = randomUUID(), forceCopy = false } = {}) {
  // Never overwrite an existing book, even if it appeared after the save dialog.
  const exists = () => new Error('An audio file already exists at that destination. Choose another filename.');
  try { if (forceCopy) throw Object.assign(new Error('Copy to another drive'), { code: 'EXDEV' }); await link(temporary, destination); }
  catch (error) {
    if (error.code === 'EEXIST') throw exists();
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid export publication.');
    const adjacent = `${destination}.cadence-${id}.partial`;
    // A cross-drive copy must not expose a half-written file as the finished book.
    await unlink(adjacent).catch(reason => { if (reason.code !== 'ENOENT') throw reason; });
    try {
      await copyFile(temporary, adjacent, constants.COPYFILE_EXCL);
      const file = await open(adjacent, 'r+'); try { await file.sync(); } finally { await file.close(); }
      try { await link(adjacent, destination); }
      catch (reason) {
        if (reason.code === 'EEXIST') throw exists();
        if (process.platform !== 'win32') throw reason;
        // File.Move on Windows is an atomic same-volume rename that refuses an existing target, including on exFAT.
        await new Promise((resolve, reject) => {
          const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[IO.File]::Move($env:CADENCE_PUBLISH_SOURCE, $env:CADENCE_PUBLISH_TARGET)'], { windowsHide: true, env: { ...process.env, CADENCE_PUBLISH_SOURCE: adjacent, CADENCE_PUBLISH_TARGET: destination }, stdio: 'ignore' });
          child.on('error', reject); child.on('exit', code => code ? reject(new Error('The finished audiobook could not be moved. Check the destination or choose another filename.')) : resolve());
        });
      }
    } finally { await unlink(adjacent).catch(() => {}); }
  }
  await unlink(temporary);
}
function executable(command, args, onChild) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '', error = '';
    onChild?.(child);
    child.stdout.on('data', data => { output = (output + data).slice(-1000000); }); child.stderr.on('data', data => { error = (error + data).slice(-4000); });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`Audio encoding stopped (${code}). ${error}`)));
  });
}
export class AudiobookJobs {
  constructor({ root, runtimeRoot, modelRoot, onProgress = () => {}, backendFactory, configuration }) {
    Object.assign(this, { root, runtimeRoot, modelRoot, onProgress, backendFactory, configuration }); this.active = null; this.stopping = false;
  }
  directory(id) { if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid export job.'); return path.join(this.root, id); }
  async configurationForJob() { return this.configuration || (await import('./audiobook-backend.mjs')).runtimeConfiguration(this.runtimeRoot); }
  async backend(engine) { return this.backendFactory ? this.backendFactory(engine) : (await import('./audiobook-backend.mjs')).createExportBackend({ engine, runtimeRoot: this.runtimeRoot, modelRoot: this.modelRoot }); }
  async list() {
    const { readdir } = await import('node:fs/promises'); await mkdir(this.root, { recursive: true }); const jobs = [];
    for (const entry of await readdir(this.root)) {
      if (!/^[a-f0-9-]{36}$/.test(entry)) continue;
      try { const job = JSON.parse(await readFile(path.join(this.directory(entry), 'job.json'), 'utf8')); if (job.id !== entry || job.version !== 1) continue; if (this.active?.job?.id !== entry && ['loading', 'running', 'encoding'].includes(job.status)) { job.status = 'paused'; job.message = 'Ready to resume from the last saved phrase.'; } jobs.push(this.summary(job)); } catch { /* An interrupted initial creation has no committed job. */ }
    }
    return jobs.sort((a, b) => b.created - a.created);
  }
  summary(job) { const { sourceHash, finishedHash, chapters, ...summary } = job; return { ...summary, chapterCount: chapters.length, audioSeconds: job.samples / rate }; }
  async save(job) { job.updated = Date.now(); await atomicJson(path.join(this.directory(job.id), 'job.json'), job); this.onProgress(this.summary(job)); }
  async create(input, output) {
    const request = validateExport(input);
    if (typeof output !== 'string' || !path.isAbsolute(output) || path.extname(output).toLowerCase() !== '.m4b') throw new Error('Choose an M4B destination.');
    try { await stat(output); throw new Error('An audio file already exists at that destination. Choose another filename.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const id = randomUUID(), directory = this.directory(id); await mkdir(directory, { recursive: true });
    const source = await open(path.join(directory, 'source.json'), 'wx'); try { await source.writeFile(JSON.stringify(request)); await source.sync(); } finally { await source.close(); }
    const offsets = exportOffsets(request.document), characters = offsets.at(-1) - offsets[request.from];
    const job = { version: 1, id, created: Date.now(), title: request.document.title, engine: request.engine, voice: request.voice, voiceName: request.voiceName, output, sourceHash: exportFingerprint(request), status: 'paused', message: 'Ready to export.', next: 0, samples: 0, completedCharacters: 0, totalCharacters: characters, progress: 0, chapters: [], generationMs: 0, estimatedWorkingBytes: Math.ceil(characters / 5 / 150 * 60 * rate * 2 * 1.3) + 256 * 1024 * 1024 };
    await this.save(job); return this.summary(job);
  }
  async pause(id) {
    const active = this.active; if (active?.job?.id !== id) return;
    active.cancelled = true; active.encoder?.kill();
    if (active.backend) await active.backend.close(true);
    await active.done?.catch(() => {});
  }
  async shutdown() { this.stopping = true; const active = this.active; if (active) { active.cancelled = true; if (active.job) await this.pause(active.job.id); await active.done?.catch(() => {}); } }
  async start(id) {
    if (this.stopping || this.active) throw new Error('Pause the current export or comparison first.');
    const active = { job: null, cancelled: false, done: null }; this.active = active;
    active.done = this.run(id, active).finally(() => { if (this.active === active) this.active = null; });
    return active.done;
  }
  async run(id, active) {
    const directory = this.directory(id); let job, file;
    try {
      job = JSON.parse(await readFile(path.join(directory, 'job.json'), 'utf8')); active.job = job;
      if (job.version !== 1 || job.id !== id || !Number.isSafeInteger(job.next) || job.next < 0 || !Number.isSafeInteger(job.samples) || job.samples < 0 || !Array.isArray(job.chapters)) throw new Error('The saved export checkpoint is invalid.');
      if (job.status === 'complete') return this.summary(job);
      if (job.finishedHash) {
        try {
          if (await fileHash(job.output) === job.finishedHash) { job.status = 'complete'; job.progress = 100; job.message = 'Audiobook saved.'; await this.save(job); await this.cleanup(id); return this.summary(job); }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const request = validateExport(JSON.parse(await readFile(path.join(directory, 'source.json'), 'utf8')));
      if (job.sourceHash !== exportFingerprint(request)) throw new Error('The export source or settings changed. Start a new job to keep the audio consistent.');
      job.status = 'loading'; job.message = 'Checking the saved export and local model…'; await this.save(job);
      const config = await this.configurationForJob();
      const identity = this.backendFactory ? 'qa-fixture-v1' : await (await import('./audiobook-backend.mjs')).exportIdentity({ engine: request.engine, runtimeRoot: this.runtimeRoot, modelRoot: this.modelRoot });
      if (job.modelIdentity && job.modelIdentity !== identity) throw new Error('The model or narration pipeline changed. Start a new export to keep this audiobook consistent. Completed audio is retained.');
      job.modelIdentity = identity;
      const space = await statfs(this.root); if (space.bavail * space.bsize < Math.max(256 * 1024 * 1024, job.estimatedWorkingBytes - job.samples * 2)) throw new Error('There is not enough working disk space for this audiobook. Free space and resume this job.');
      const pcmPath = path.join(directory, 'audio.pcm');
      try { file = await open(pcmPath, 'r+'); } catch (error) { if (error.code !== 'ENOENT') throw error; file = await open(pcmPath, 'wx+'); }
      const size = (await file.stat()).size;
      if (size < job.samples * 2) throw new Error('Completed export audio is missing. Keep the job folder intact and start a new export.');
      if (size > job.samples * 2) await file.truncate(job.samples * 2);
      const source = exportSource(request.document, request.from), targets = chapterTargets(request.document, request.from), offsets = exportOffsets(request.document);
      let index = 0, target = 0;
      // Rebuild text metadata only; completed audio is never synthesized again.
      while (index < job.next) { if (!source.get(index)) throw new Error('The saved export position is invalid.'); source.release(++index); }
      const first = source.get(index);
      const position = first ? offsets[first.parts[0].segment] + first.parts[0].start : Infinity;
      while (target < targets.length && offsets[targets[target].segment] + targets[target].character < position) target++;
      if (first && !active.cancelled) {
        job.status = 'loading'; job.message = 'Loading the local export voice…'; await this.save(job);
        active.backend = await this.backend(request.engine);
        job.device = active.backend.details.device; job.provider = active.backend.details.provider; job.status = 'running'; job.message = 'Creating audio. Your place is saved after each phrase.'; await this.save(job);
      }
      const check = () => { if (active.cancelled) throw new Error('Export paused.'); };
      for (let current = first; current; current = source.get(++index)) {
        check(); const next = source.get(index + 1), began = performance.now();
        const audio = await active.backend.generate(current.text, request.voice, check); check();
        if (audio.sampling_rate !== rate || !(audio.audio instanceof Float32Array) || audio.audio.length > rate * 300 || !audio.audio.length || !audio.audio.every(Number.isFinite)) throw new Error('The model returned invalid audio. Completed phrases remain saved.');
        const bounds = speechClipBounds(audio.audio, rate, current, next), pcm = pcm16(audio.audio, Math.round(bounds.offset * rate), Math.min(audio.audio.length, Math.round((bounds.offset + bounds.duration) * rate)));
        const endPart = current.parts.at(-1), end = offsets[endPart.segment] + endPart.end;
        let title = job.samples ? undefined : job.title;
        while (target < targets.length && offsets[targets[target].segment] + targets[target].character < end) title = targets[target++].title;
        const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength); let written = 0;
        while (written < bytes.length) { const count = (await file.write(bytes, written, bytes.length - written, job.samples * 2 + written)).bytesWritten; if (!count) throw new Error('The export disk stopped accepting audio.'); written += count; }
        await file.sync();
        // Commit metadata only after the PCM is durable. Resume truncates any uncommitted tail.
        if (title && job.chapters.at(-1)?.sample !== job.samples) job.chapters.push({ title, sample: job.samples });
        job.samples += pcm.length; job.next = index + 1; job.generationMs += performance.now() - began;
        job.completedCharacters = Math.max(0, end - offsets[request.from]); job.progress = Math.min(99, job.completedCharacters / Math.max(1, job.totalCharacters) * 100); await this.save(job); source.release(index + 1);
      }
      await file.close(); file = null; await active.backend?.close(); active.backend = null; check();
      if (!job.samples) throw new Error('This document has no spoken text after margin cleanup.');
      job.status = 'encoding'; job.message = 'Finishing your chaptered M4B…'; await this.save(job);
      const metadata = path.join(directory, 'chapters.txt'), temporary = path.join(directory, 'finished.m4b');
      const { writeFile } = await import('node:fs/promises'); await writeFile(metadata, chapterMetadata(job));
      const began = performance.now();
      await executable(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', pcmPath, '-f', 'ffmetadata', '-i', metadata, '-map', '0:a', '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', temporary], child => { active.encoder = child; }); active.encoder = null; check();
      const probe = JSON.parse(await executable(config.ffprobe, ['-v', 'error', '-show_format', '-show_chapters', '-show_streams', '-of', 'json', temporary]));
      if (!probe.streams.some(stream => stream.codec_name === 'aac') || Math.abs(Number(probe.format.duration) - job.samples / rate) > .25 || probe.chapters.length !== job.chapters.length) throw new Error('The finished audiobook did not pass the output check. Completed speech remains saved.');
      const finished = await open(temporary, 'r+'); try { await finished.sync(); } finally { await finished.close(); }
      job.finishedHash = await fileHash(temporary); await this.save(job); check();
      await publishAudio(temporary, job.output, { id: job.id }); job.encodingMs = performance.now() - began; job.status = 'complete'; job.progress = 100; job.message = 'Audiobook saved.'; await this.save(job);
      await this.cleanup(id); return this.summary(job);
    } catch (error) {
      if (!job) throw error;
      job.status = active.cancelled ? 'paused' : 'error'; job.message = active.cancelled ? 'Paused. Resume from the last saved phrase.' : error.message;
      await this.save(job); return this.summary(job);
    } finally { await file?.close(); await active.backend?.close(true); }
  }
  async cleanup(id) {
    for (const name of ['audio.pcm', 'source.json', 'finished.m4b', 'chapters.txt']) {
      try { await unlink(path.join(this.directory(id), name)); } catch { /* A complete job stays complete if Windows temporarily holds a file. */ }
    }
  }
  async sample(input) {
    const request = validateExport(input);
    if (this.active || this.stopping) throw new Error('Pause the current export before comparing voices.');
    const active = { job: { id: 'sample', engine: request.engine }, cancelled: false }; this.active = active;
    active.done = (async () => {
      const source = exportSource(request.document, request.from); let text = '';
      for (let i = 0; i < 4; i++) { const part = source.get(i); if (!part || (text && text.length + part.text.length > 650)) break; text += (text ? '\n\n' : '') + part.text; }
      if (!text) throw new Error('Choose a passage with spoken text.');
      const began = performance.now(); active.backend = await this.backend(request.engine); const loaded = performance.now();
      const audio = await active.backend.generate(text, request.voice, () => { if (active.cancelled) throw new Error('Comparison stopped.'); });
      return { bytes: wavBytes(audio.audio, audio.sampling_rate), loadMs: loaded - began, generationMs: performance.now() - loaded, audioSeconds: audio.audio.length / audio.sampling_rate, text, device: active.backend.details.device };
    })().finally(async () => { await active.backend?.close(true); if (this.active === active) this.active = null; });
    return active.done;
  }
}
