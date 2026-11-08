import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AudiobookJobs, validateExport, exportFingerprint, chapterMetadata, publishAudio, atomicJson } from '../desktop/audiobook-jobs.mjs';
import { chapterTargets, exportSource } from '../desktop/export-core.mjs';
const paragraphs = [
  'The first passage has several ordinary words, and it continues long enough to remain a complete sentence of its own.',
  'The second passage has a different set of words, and its saved audio must survive a pause without being generated again.',
  'The final passage contains a clear conclusion, and it follows the earlier passages in the same order after a restart.',
];
const input = () => ({ document: { id: 'fixture', title: 'A book', kind: 'EPUB', pageCount: 2, segments: paragraphs.map((text, i) => ({ text, page: i === 2 ? 2 : 1, heading: false })), topics: [{ title: 'Part one', page: 1, segment: 0, children: [{ title: 'An opening', page: 1, segment: 0 }] }, { title: 'The conclusion', page: 2, segment: 2 }] }, from: 0, engine: 'kokoro-cuda', voice: 'af_heart', voiceName: 'Heart' });
async function folder() { await mkdir('test-results/audiobook-unit', { recursive: true }); return mkdtemp(path.resolve('test-results/audiobook-unit/case-')); }
const factory = (calls, generate) => async () => ({ details: { device: 'test device', provider: ['fixture'] }, generate: async (text, voice, check) => { check(); calls.push(text); if (generate) return generate(text, check); return { audio: new Float32Array(2400).fill(.1), sampling_rate: 24000 }; }, close: async () => {} });

describe('offline audiobook jobs', () => {
  it('retains the old checkpoint while retrying a transient Windows file lock', async () => {
    if (process.platform !== 'win32') return;
    const root = await folder(), filename = path.join(root, 'checkpoint.json'); await atomicJson(filename, { next: 1 });
    const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$file = [IO.File]::Open($env:CADENCE_QA_LOCK_FILE, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read); try { [Console]::WriteLine('READY'); Start-Sleep -Milliseconds 700 } finally { $file.Dispose() }"], { windowsHide: true, env: { ...process.env, CADENCE_QA_LOCK_FILE: filename }, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise(resolve => locker.once('close', resolve));
    try {
      await new Promise((resolve, reject) => { locker.stdout.once('data', data => String(data).includes('READY') ? resolve() : reject(new Error('The checkpoint lock did not open.'))); locker.once('error', reject); locker.once('exit', code => reject(new Error(`The checkpoint lock stopped (${code}).`))); });
      const saving = atomicJson(filename, { next: 2 }); expect(JSON.parse(await readFile(filename, 'utf8'))).toEqual({ next: 1 }); await saving;
      expect(JSON.parse(await readFile(filename, 'utf8'))).toEqual({ next: 2 });
    } finally { await closed; }
  });
  it('validates source, chapter positions, settings and native paths before creation', async () => {
    const good = input();
    expect(validateExport(good)).toEqual(good); expect(validateExport({ ...good, engine: 'kokoro-cpu' }).engine).toBe('kokoro-cpu');
    for (const bad of [null, { ...good, voice: '../secret' }, { ...good, engine: 'cloud' }, { ...good, from: -1 }, { ...good, engine: 'qwen-cuda', voice: 'af_heart' }, { ...good, engine: 'chatterbox-cuda' }, { ...good, engine: 'chatterbox-standard-cuda' }, { ...good, referencePath: path.resolve('sample.wav') }, { ...good, voice: 'custom_reference' }, { ...good, document: { ...good.document, segments: [{ text: 'bad', page: -1 }] } }, { ...good, document: { ...good.document, topics: [{ title: 'bad', page: 1, segment: 99 }] } }]) expect(() => validateExport(bad)).toThrow();
    const root = await folder(), jobs = new AudiobookJobs({ root });
    expect(() => jobs.directory('../../outside')).toThrow();
    await expect(jobs.create(good, 'relative.m4b')).rejects.toThrow(); await expect(jobs.create(good, path.join(root, 'book.wav'))).rejects.toThrow();
  });
  it('keeps removed-model history and audio without resuming it through a different model', async () => {
    for (const engine of ['chatterbox-cuda', 'chatterbox-standard-cuda']) {
      const root = await folder(), calls = [], jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls) });
      const created = await jobs.create(input(), path.join(root, 'book.m4b')), directory = path.join(root, created.id), legacy = { ...input(), engine };
      const saved = JSON.parse(await readFile(path.join(directory, 'job.json'), 'utf8')), prefix = Buffer.alloc(2400, 7);
      await writeFile(path.join(directory, 'source.json'), JSON.stringify(legacy)); await writeFile(path.join(directory, 'audio.pcm'), prefix);
      await atomicJson(path.join(directory, 'job.json'), { ...saved, engine, sourceHash: exportFingerprint(legacy), next: 1, samples: 1200 });
      expect((await jobs.list())[0]).toMatchObject({ engine, status: 'paused', audioSeconds: .05 });
      expect((await jobs.start(created.id)).status).toBe('error'); expect(calls).toEqual([]); expect(await readFile(path.join(directory, 'audio.pcm'))).toEqual(prefix);
      const failed = JSON.parse(await readFile(path.join(directory, 'job.json'), 'utf8')); await atomicJson(path.join(directory, 'job.json'), { ...failed, status: 'complete', progress: 100 });
      expect((await jobs.list())[0]).toMatchObject({ engine, status: 'complete', progress: 100 });
    }
  });
  it('maps hierarchical EPUB and page-only PDF chapters in source order', () => {
    const doc = input().document;
    expect(chapterTargets(doc).map(item => item.title)).toEqual(['Part one', 'Part one › An opening', 'The conclusion']);
    expect(chapterTargets(doc, 1).map(item => item.title)).toEqual(['The conclusion']);
    expect(chapterTargets({ ...doc, topics: [{ title: 'Physical page two', page: 2 }] })[0].segment).toBe(2);
    expect(chapterTargets({ ...doc, topics: undefined, segments: [{ text: 'Opening', page: 1, heading: true }, ...doc.segments] })[0].title).toBe('Opening');
  });
  it('uses identical margin-cleaned sentence text without rewriting the source', () => {
    const doc = { kind: 'PDF', segments: [1, 2, 3].flatMap(page => [{ text: 'BOOK TITLE', page }, { text: paragraphs[page - 1], page, heading: false }, { text: String(page), page }]) };
    const before = JSON.stringify(doc), source = exportSource(doc), text = [];
    for (let i = 0, chunk; (chunk = source.get(i)); i++) { text.push(chunk.text); source.release(i + 1); }
    expect((text.join(' ').match(/BOOK TITLE/g) || [])).toHaveLength(1); expect(text.join(' ')).not.toMatch(/\b[123]\b/); expect(text.join(' ')).toContain(paragraphs[2]); expect(JSON.stringify(doc)).toBe(before);
  });
  it('escapes metadata and preserves non-overlapping long-book chapter times', () => {
    const text = chapterMetadata({ title: 'Title\n[CHAPTER];=', voiceName: 'A#B\\C', samples: 24000 * 60 * 60 * 60, chapters: [{ title: 'One', sample: 0 }, { title: 'Two', sample: 24000 * 60 * 60 * 30 }] });
    expect(text).toContain('END=216000000'); expect(text).toContain('START=108000000'); expect(text).toContain('title=Title [CHAPTER]\\;\\='); expect(text).toContain('artist=A\\#B\\\\C');
  });
  it('never overwrites an existing output or a file created during finalization', async () => {
    const root = await folder(), temporary = path.join(root, 'new.m4b'), output = path.join(root, 'existing.m4b');
    await writeFile(temporary, 'new audio'); await writeFile(output, 'original audio');
    await expect(publishAudio(temporary, output)).rejects.toThrow(/already exists/); expect(await readFile(output, 'utf8')).toBe('original audio'); expect(await readFile(temporary, 'utf8')).toBe('new audio');
    await publishAudio(temporary, path.join(root, 'published.m4b')); expect(await readFile(path.join(root, 'published.m4b'), 'utf8')).toBe('new audio');
    await writeFile(temporary, 'cross-drive audio'); await publishAudio(temporary, path.join(root, 'copied.m4b'), { forceCopy: true }); expect(await readFile(path.join(root, 'copied.m4b'), 'utf8')).toBe('cross-drive audio');
    await expect(new AudiobookJobs({ root }).create(input(), output)).rejects.toThrow(/already exists/);
  });
  it('pauses durably, discards an uncommitted PCM tail and resumes without repeating speech', async () => {
    const root = await folder(), calls = [];
    const jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls), onProgress: job => { if (job.status === 'running' && job.progress > 0) void jobs.pause(job.id); } });
    const created = await jobs.create(input(), path.join(root, 'book.m4b')), paused = await jobs.start(created.id);
    expect(paused.status).toBe('paused'); expect(paused.next).toBe(1); expect(calls).toEqual([paragraphs[0]]);
    const pcm = path.join(root, created.id, 'audio.pcm'), first = await readFile(pcm); await appendFile(pcm, 'uncommitted crash data');
    const calls2 = [], resumed = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls2), onProgress: job => { if (job.status === 'running' && job.next === 2) void resumed.pause(job.id); } });
    const checkpoint = await resumed.start(created.id);
    expect(checkpoint.status).toBe('paused'); expect(checkpoint.next).toBe(2); expect(calls2).toEqual([paragraphs[1]]); expect((await stat(pcm)).size).toBe(9600); expect((await readFile(pcm)).subarray(0, first.length)).toEqual(first);
    const saved = JSON.parse(await readFile(path.join(root, created.id, 'job.json'), 'utf8')); expect(saved.chapters.map(item => item.title)).toEqual(['Part one › An opening']);
  });
  it('rejects changed sources and missing durable PCM without synthesizing', async () => {
    const root = await folder(), calls = [], jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls), onProgress: job => { if (job.next === 1) void jobs.pause(job.id); } });
    const created = await jobs.create(input(), path.join(root, 'book.m4b')); await jobs.start(created.id);
    const source = path.join(root, created.id, 'source.json'), changed = input(); changed.document.segments[1].text = 'Changed book content.'; await writeFile(source, JSON.stringify(changed));
    const resumed = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls) }); expect((await resumed.start(created.id)).message).toMatch(/changed/); expect(calls).toHaveLength(1);
    await writeFile(source, JSON.stringify(input())); await writeFile(path.join(root, created.id, 'audio.pcm'), ''); expect((await resumed.start(created.id)).message).toMatch(/missing/); expect(calls).toHaveLength(1);
  });
  it('retains the last completed phrase after a helper failure and can retry it', async () => {
    const root = await folder(), calls = [], jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls, text => { if (text === paragraphs[1]) throw new Error('Simulated GPU failure'); return { audio: new Float32Array(2400).fill(.1), sampling_rate: 24000 }; }) });
    const created = await jobs.create(input(), path.join(root, 'book.m4b')), failed = await jobs.start(created.id);
    expect(failed.status).toBe('error'); expect(failed.next).toBe(1); expect(failed.message).toBe('Simulated GPU failure');
    const calls2 = [], retry = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls2), onProgress: job => { if (job.next === 2 && job.status === 'running') void retry.pause(job.id); } }); await retry.start(created.id); expect(calls2).toEqual([paragraphs[1]]);
  });
  it('holds one export at a time and restores interrupted states as paused', async () => {
    const root = await folder(), calls = [], jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls), onProgress: job => { if (job.next === 1) void jobs.pause(job.id); } });
    const created = await jobs.create(input(), path.join(root, 'book.m4b')), first = jobs.start(created.id); await expect(jobs.start(created.id)).rejects.toThrow(/current export/); await first;
    const file = path.join(root, created.id, 'job.json'), interrupted = JSON.parse(await readFile(file, 'utf8')); interrupted.status = 'running'; await writeFile(file, JSON.stringify(interrupted));
    expect((await new AudiobookJobs({ root }).list())[0].status).toBe('paused');
    const validated = validateExport(input());
    expect(exportFingerprint(validated)).toBe(exportFingerprint(JSON.parse(JSON.stringify(validated))));
  });
  it('stops before model loading when there is insufficient working space', async () => {
    const root = await folder(), calls = [], jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls) });
    const created = await jobs.create(input(), path.join(root, 'book.m4b')), filename = path.join(root, created.id, 'job.json'), checkpoint = JSON.parse(await readFile(filename, 'utf8'));
    checkpoint.estimatedWorkingBytes = Number.MAX_SAFE_INTEGER; await writeFile(filename, JSON.stringify(checkpoint));
    const result = await jobs.start(created.id); expect(result.status).toBe('error'); expect(result.message).toMatch(/disk space/); expect(result.next).toBe(0); expect(calls).toHaveLength(0);
  });
  it('rejects a changed model or pacing pipeline before resuming', async () => {
    const root = await folder(), calls = [], jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory(calls) });
    const created = await jobs.create(input(), path.join(root, 'book.m4b')), filename = path.join(root, created.id, 'job.json'), checkpoint = JSON.parse(await readFile(filename, 'utf8'));
    checkpoint.modelIdentity = 'another-model'; await writeFile(filename, JSON.stringify(checkpoint));
    expect((await jobs.start(created.id)).message).toMatch(/model or narration pipeline changed/); expect(calls).toHaveLength(0);
  });
  it('preserves distinct consecutive chapters that share the same title', async () => {
    const root = await folder(), request = input(); request.document.topics = [{ title: 'A repeated title', page: 1, segment: 0 }, { title: 'A repeated title', page: 1, segment: 1 }];
    const jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory([]), onProgress: job => { if (job.next === 2) void jobs.pause(job.id); } });
    const created = await jobs.create(request, path.join(root, 'book.m4b')), result = await jobs.start(created.id); expect(result.status).toBe('paused'); expect(result.chapterCount).toBe(2);
  });
  it('queues paused exports and removes export workspaces to reclaim disk space', async () => {
    const root = await folder(), jobs = new AudiobookJobs({ root, configuration: {}, backendFactory: factory([]) });
    const created = await jobs.create(input(), path.join(root, 'book.m4b'));
    const queued = await jobs.queue(created.id, true);
    expect(queued.queued).toBe(true);
    expect(queued.message).toMatch(/Queued/);
    const unqueued = await jobs.queue(created.id, false);
    expect(unqueued.queued).toBeUndefined();
    expect(await jobs.remove(created.id)).toBe(true);
    expect(await jobs.list()).toEqual([]);
  });
});
