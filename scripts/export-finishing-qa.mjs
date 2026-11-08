import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, open, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { AudiobookJobs, atomicJson } from '../desktop/audiobook-jobs.mjs';
import { exportSource } from '../desktop/export-core.mjs';
import { runtimeConfiguration } from '../desktop/audiobook-backend.mjs';
import { menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const staged = process.argv.includes('--staged'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = path.resolve(`test-results/export-finishing/${staged ? 'staged' : 'source'}-${Date.now()}`); await mkdir(output, { recursive: true });
const profile = path.join(output, 'profile'), root = path.join(profile, 'audiobook-jobs');
const request = { document: { id: 'finishing-fixture', title: 'Three-hour file creation fixture', kind: 'NOTE', pageCount: 1, segments: [{ text: 'The first chapter provides a complete sentence for this isolated final file creation fixture.', page: 1, heading: false }, { text: 'The second chapter confirms that saved audio and chapter markers survive pausing and restarting.', page: 1, heading: false }] }, from: 0, engine: 'kokoro-cuda', voice: 'af_heart', voiceName: 'Heart' };
const seed = new AudiobookJobs({ root }), created = await seed.create(request, path.join(output, 'finished.m4b')), directory = path.join(root, created.id), filename = path.join(directory, 'job.json');
const saved = JSON.parse(await readFile(filename, 'utf8')), source = exportSource(request.document); let next = 0; while (source.get(next)) source.release(++next);
Object.assign(saved, { next, samples: 24000 * 10800, chapters: [{ title: 'First chapter', sample: 0 }, { title: 'Second chapter', sample: 24000 * 5400 }], completedCharacters: saved.totalCharacters, progress: 99 });
const pcm = await open(path.join(directory, 'audio.pcm'), 'wx+'); try { await pcm.truncate(saved.samples * 2); } finally { await pcm.close(); } await atomicJson(filename, saved);
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
let app, page, native = ''; const checks = [], errors = [], external = [];
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  app.process().stderr.on('data', data => native = (native + data).slice(-50000)); page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1100, 760); BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true); }); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
}
async function close() { if (!app) return; const closed = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed; app = null; }
async function manager() { await menuClick(page.getByRole('button', { name: 'Audio exports', exact: true })); await page.getByRole('heading', { name: 'Audio exports', exact: true }).waitFor(); }
async function jobs() { return page.evaluate(() => window.cadence.exportJobs()); }
async function until(predicate, timeout = 120000) { const end = Date.now() + timeout; while (true) { const result = await predicate(); if (result) return result; assert(Date.now() < end, 'File creation did not settle'); await page.waitForTimeout(100); } }
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
try {
  await start(); await manager(); const row = () => page.locator(`[data-export-id="${created.id}"]`);
  await check('Saved narration enters independently measured file creation with encoded duration and an estimate', async () => {
    await row().getByRole('button', { name: 'Resume export', exact: true }).click();
    await until(async () => { const job = (await jobs())[0]; assert.notEqual(job.status, 'error', job.message); return job.finishing?.phase === 'encoding' && job.finishing.percent > 0 && job.finishing.percent < 99 && job.finishing.remainingSeconds > 0; });
    assert.match(await row().getByLabel('File creation details', { exact: true }).textContent(), /encoded.*elapsed/); await row().getByLabel('Estimated completion', { exact: true }).getByText(/left/).waitFor(); assert.match(await row().locator('.export-job-progress b').textContent(), /% file/);
    await page.screenshot({ path: path.join(output, 'file-progress.png') });
  });
  let compressed;
  await check('Pausing file creation retains every narrated sample and completed compressed sections across restart', async () => {
    await row().getByRole('button', { name: 'Pause export', exact: true }).click(); await until(async () => (await jobs())[0].status === 'paused');
    const checkpoint = JSON.parse(await readFile(filename, 'utf8')); assert.equal(checkpoint.next, saved.next); assert.equal(checkpoint.samples, saved.samples); assert.match(checkpoint.message, /completed compressed sections are saved/); assert.equal((await stat(path.join(directory, 'audio.pcm'))).size, saved.samples * 2); assert(!('finishing' in checkpoint));
    compressed = await readFile(path.join(directory, 'encoding/part-00000000.aac')); assert(checkpoint.encodedSamples > 0); assert(compressed.length > 0);
    await close(); await start(); await manager(); assert.equal((await jobs())[0].status, 'paused'); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0); assert.deepEqual(await readFile(path.join(directory, 'encoding/part-00000000.aac')), compressed);
  });
  await check('Resume finishes the three-hour M4B with correct chapters without loading a synthesis model', async () => {
    await row().getByRole('button', { name: 'Resume export', exact: true }).click(); const result = await until(async () => { const job = (await jobs())[0]; assert.notEqual(job.status, 'error', job.message); return job.status === 'complete' ? job : undefined; }); assert.equal(result.device, undefined); assert.equal(result.progress, 100);
    const config = await runtimeConfiguration(path.resolve('.cache/audiobook'));
    const info = await new Promise((resolve, reject) => { const child = spawn(config.ffprobe, ['-v', 'error', '-show_format', '-show_chapters', '-of', 'json', result.output], { windowsHide: true }); let text = ''; child.stdout.on('data', data => text += data); child.on('error', reject); child.on('close', code => code ? reject(new Error('File validation failed')) : resolve(JSON.parse(text))); });
    assert(Math.abs(Number(info.format.duration) - 10800) < .25); assert.deepEqual(info.chapters.map(chapter => chapter.tags.title), ['First chapter', 'Second chapter']); await page.screenshot({ path: path.join(output, 'file-complete.png') });
    const playback = await page.evaluate(async bytes => {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' })), audio = new Audio(); audio.muted = true;
      const event = name => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('The M4B playback check timed out.')), 10000); audio.addEventListener(name, () => { clearTimeout(timer); resolve(); }, { once: true }); audio.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Chromium could not read the M4B.')); }, { once: true }); });
      try { const loaded = event('loadedmetadata'); audio.src = url; await loaded; const seeked = event('seeked'); audio.currentTime = 10799.5; await seeked; await audio.play(); await new Promise(resolve => setTimeout(resolve, 250)); audio.pause(); return { duration: audio.duration, time: audio.currentTime, paused: audio.paused }; }
      finally { audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url); }
    }, [...await readFile(result.output)]);
    assert(Math.abs(playback.duration - 10800) < .01); assert(playback.time > 10799.5 && playback.paused); await writeFile(path.join(output, 'chromium-playback.json'), JSON.stringify(playback, null, 2));
  });
  await check('No renderer errors, automatic narration or external book/audio requests occur', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0); });
} catch (error) { errors.push(error.stack); process.exitCode = 1; console.error(error); if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
finally { await close().catch(() => {}); await writeFile(path.join(output, 'native.log'), native); await writeFile(path.join(output, 'report.json'), JSON.stringify({ staged, output, checks, errors, external }, null, 2)); }
