import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { navigationPdf } from './navigation-fixture.mjs';
import { menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright'), JSZip = require('jszip');
const staged = process.argv.includes('--staged'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
const sustained = process.argv.includes('--sustained');
const output = path.resolve('test-results/audiobook/ui-' + (staged ? 'staged-' : 'source-') + Date.now()); await mkdir(output, { recursive: true });
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
const checks = [], errors = [], external = [], nativeExits = []; let app, page, pdfJob, checkpoint, compressedPrefix, nativeLog = '';
const epub = new JSZip(); epub.file('mimetype', 'application/epub+zip'); epub.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
epub.file('OPS/book.opf', '<package><metadata><title>Audiobook QA</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
epub.file('OPS/one.xhtml', '<html><body><h1 id="one">A quiet beginning</h1><p>The first light reached the window before the town began to stir. Across the square, a shopkeeper opened the shutters.</p></body></html>');
epub.file('OPS/two.xhtml', '<html><body><h1 id="two">Another chapter</h1><p>Good decisions often begin with patient observation. A useful explanation connects evidence with consequences and leaves room for uncertainty.</p></body></html>');
epub.file('OPS/nav.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml#one">A quiet beginning</a></li><li><a href="two.xhtml#two">Another chapter</a></li></ol></nav></body></html>');
await writeFile(path.join(output, 'book.epub'), await epub.generateAsync({ type: 'nodebuffer' })); await writeFile(path.join(output, 'Scrolling.pdf'), navigationPdf({ count: 20 }));
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  app.process().stderr.on('data', data => { nativeLog = (nativeLog + data).slice(-200000); }); app.process().on('exit', (code, signal) => nativeExits.push({ code, signal }));
  page = await app.firstWindow(); page.setDefaultTimeout(25000); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1480, 960); BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true); });
}
async function close() { if (!app) return; const closed = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 50); }); await closed; app = null; }
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function manager() { if (await page.getByLabel('Close dialog', { exact: true }).isVisible()) await page.getByLabel('Close dialog', { exact: true }).click(); if (!await page.getByRole('region', { name: 'Audio export manager', exact: true }).isVisible()) await menuClick(page.getByRole('button', { name: 'Audio exports', exact: true })); await page.getByRole('heading', { name: 'Audio exports', exact: true }).waitFor(); }
async function exportPanel() { await manager(); await page.getByRole('button', { name: 'New export', exact: true }).click(); await page.getByLabel('Audio format', { exact: true }).waitFor(); }
async function saveAs(filename) { await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, filename); }
async function jobs() { return page.evaluate(() => window.cadence.exportJobs()); }
async function until(predicate, timeout = 90000) { const end = Date.now() + timeout; while (true) { const value = await predicate(); if (value) return value; assert(Date.now() < end, 'Audiobook state did not settle'); await page.waitForTimeout(150); } }
async function waitJob(id, states, timeout = 90000) { return until(async () => { const job = (await jobs()).find(job => job.id === id); return job && states.includes(job.status) ? job : undefined; }, timeout); }
async function choose(engine) { await page.getByLabel('Export model', { exact: true }).selectOption(engine); }
async function compare() { await page.getByRole('button', { name: 'Compare a passage', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.export-actions .spin'), null, { timeout: 180000 }); assert.equal(await page.locator('.export-error').count(), 0); }
try {
  await start(); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.locator('input[type=file]').setInputFiles(path.join(output, 'book.epub')); await page.getByRole('heading', { name: 'Audiobook QA', exact: true }).waitFor();
  await check('Audio exports has its own empty manager and returns to the same document', async () => {
    await manager(); await page.getByRole('heading', { name: 'Your audiobooks will stay here', exact: true }).waitFor(); assert.equal(await page.getByLabel('Audio format', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Back to reading', exact: true }).click(); await page.getByRole('button', { name: 'Document view', exact: true }).waitFor();
  });
  await check('M4B is the default and cancelling the destination creates no job', async () => {
    await exportPanel(); assert.equal(await page.getByLabel('Audio format', { exact: true }).inputValue(), 'm4b'); await page.getByRole('button', { name: 'Create M4B audiobook', exact: true }).waitFor();
    const runtime = await page.evaluate(() => window.cadence.exportRuntime()); assert(runtime.tools && runtime.kokoroGpu); assert.equal(runtime.chatterboxGpu, undefined); assert.equal(runtime.chatterboxStandardGpu, undefined); assert.equal(runtime.defaultReference, undefined);
    assert.deepEqual(await page.getByLabel('Export model', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['kokoro-cuda', 'kokoro-cpu']); assert.equal(await page.getByLabel('Export voice', { exact: true }).locator('option[value="custom_reference"]').count(), 0); assert.equal(await page.evaluate(() => typeof window.cadence.chooseReferenceAudio), 'undefined');
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); }); await page.getByRole('button', { name: 'Create M4B audiobook', exact: true }).click(); await page.waitForTimeout(200); assert.equal((await jobs()).length, 0);
  });
  if (!process.argv.includes('--skip-comparisons')) {
  await check('GPU and CPU compare the same passage with playable, initially paused samples; Qwen is absent', async () => {
    for (const engine of ['kokoro-cuda', 'kokoro-cpu']) { await choose(engine); await compare(); }
    assert.equal(await page.locator('.export-samples audio').count(), 2);
    const audio = await page.locator('.export-samples audio').evaluateAll(elements => elements.map(element => ({ paused: element.paused, duration: element.duration, autoplay: element.autoplay }))); assert(audio.every(item => item.paused && !item.autoplay && item.duration > 0));
    assert.equal(await page.getByLabel('Export model', { exact: true }).locator('option').count(), 2);
    const texts = await page.locator('.export-samples details p').allTextContents(); assert(texts.every(text => text === texts[0]));
    await page.locator('.export-samples audio').last().evaluate(async element => { await element.play(); element.pause(); });
    await page.screenshot({ path: path.join(output, 'comparisons.png') });
  });
  await check('A stopped comparison releases its model and adds no unwanted audio', async () => {
    await page.getByRole('button', { name: 'Compare a passage', exact: true }).click(); await page.getByRole('button', { name: 'Stop comparison', exact: true }).click(); await page.getByRole('button', { name: 'Stop comparison', exact: true }).waitFor({ state: 'hidden', timeout: 45000 }); assert.equal(await page.locator('.export-samples audio').count(), 2);
  });
  }
  let epubJob;
  await check('A complete EPUB exports in the background to one chaptered M4B', async () => {
    await choose('kokoro-cuda'); await saveAs(path.join(output, 'epub.m4b')); await page.getByRole('button', { name: 'Create M4B audiobook', exact: true }).click();
    epubJob = await until(async () => (await jobs())[0]);
    await page.getByRole('button', { name: 'Back to reading', exact: true }).click(); await page.getByRole('button', { name: 'Document view', exact: true }).click();
    const result = await waitJob(epubJob.id, ['complete', 'error']); assert.equal(result.status, 'complete', result.message); assert.equal(result.chapterCount, 2); assert((await stat(result.output)).size > 2000);
    await assert.rejects(stat(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', result.id, 'audio.pcm')));
  });
  await check('Existing audiobook files are protected and export controls fit a compact window', async () => {
    const before = createHash('sha256').update(await readFile(epubJob.output)).digest('hex'); await exportPanel(); await saveAs(epubJob.output); await page.getByRole('button', { name: 'Create M4B audiobook', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'already exists' }).waitFor(); assert.equal(createHash('sha256').update(await readFile(epubJob.output)).digest('hex'), before);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700));
    const geometry = await page.locator('.dialog').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, height: element.getBoundingClientRect().height, screen: innerHeight })); assert(geometry.scroll <= geometry.width + 1); assert(geometry.height < geometry.screen); await page.getByLabel('Close dialog', { exact: true }).click(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1480, 960));
  });
  await page.locator('input[type=file]').setInputFiles(path.join(output, 'Scrolling.pdf')); await page.getByRole('heading', { name: 'Scrolling', exact: true }).waitFor(); await page.getByRole('button', { name: 'Document view', exact: true }).click();
  await check('PDF scrolling and real reader narration remain usable during a separate GPU export', async () => {
    await exportPanel(); await saveAs(path.join(output, 'pdf.m4b')); await page.getByRole('button', { name: 'Create M4B audiobook', exact: true }).click(); pdfJob = await until(async () => (await jobs()).find(job => job.title === 'Scrolling')); await waitJob(pdfJob.id, ['running', 'error']);
    await until(async () => { const job = (await jobs()).find(job => job.id === pdfJob.id); assert.notEqual(job.status, 'error', job.message); return job.status === 'running' && job.encodedSamples > 0; });
    await page.getByRole('button', { name: 'Back to reading', exact: true }).click(); await page.mouse.move(20, 20); const show = page.getByRole('button', { name: 'Show playback controls', exact: true }); if (await show.isVisible()) await show.click(); await page.getByLabel('Play narration', { exact: true }).click(); await page.getByLabel('Pause narration', { exact: true }).waitFor({ timeout: 60000 });
    const scroll = await page.locator('.reader-scroll').boundingBox(); await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + scroll.height / 2);
    const compressedBeforeScroll = (await jobs()).find(job => job.id === pdfJob.id).encodedSamples;
    const measuring = page.evaluate(limit => new Promise(resolve => { const frames = []; let before = performance.now(), count = 0; const step = now => { frames.push(now - before); before = now; if (++count < limit) requestAnimationFrame(step); else resolve({ max: Math.max(...frames), p95: [...frames].sort((a, b) => a - b)[Math.floor(frames.length * .95)], over50: frames.filter(time => time > 50).length, frames }); }; requestAnimationFrame(step); }), sustained ? 3600 : 900);
    for (let i = 0; i < (sustained ? 100 : 30); i++) { await page.mouse.wheel(0, sustained ? i % 40 < 24 ? 120 : -120 : i < 18 ? 300 : -100); await page.waitForTimeout(sustained ? 500 : 150); }
    const frames = await measuring; assert(frames.max < 250 && frames.p95 < 40 && frames.over50 < 18, JSON.stringify(frames)); frames.compressedBeforeScroll = compressedBeforeScroll; frames.compressedAfterScroll = (await jobs()).find(job => job.id === pdfJob.id).encodedSamples; assert(frames.compressedAfterScroll > compressedBeforeScroll); await writeFile(path.join(output, 'scroll-during-export.json'), JSON.stringify(frames, null, 2));
    const browsed = Number(await page.locator('.pdf-document').getAttribute('data-page')); assert(browsed > 1); assert(await page.getByLabel('Pause narration', { exact: true }).isEnabled());
    await manager(); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 1); await page.getByRole('button', { name: 'Back to reading', exact: true }).click(); await page.locator('.pdf-document').waitFor(); await until(async () => Number(await page.locator('.pdf-document').getAttribute('data-page')) === browsed);
    await page.mouse.move(20, 20); const reveal = page.getByRole('button', { name: 'Show playback controls', exact: true }); if (await reveal.isVisible()) await reveal.click(); await page.getByLabel('Pause narration', { exact: true }).click();
    assert((await jobs()).find(job => job.id === pdfJob.id).progress > 0); await page.screenshot({ path: path.join(output, 'pdf-during-export.png') });
  });
  await check('Pause commits completed PDF phrases and a normal app restart restores the saved export', async () => {
    await manager(); const row = page.locator(`[data-export-id="${pdfJob.id}"]`); await row.getByRole('button', { name: 'Pause export', exact: true }).click(); await waitJob(pdfJob.id, ['paused']); checkpoint = JSON.parse(await readFile(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'job.json'), 'utf8')); assert(checkpoint.next > 0 && checkpoint.samples > 0);
    assert(checkpoint.encodedSamples > 0); compressedPrefix = await readFile(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'encoding/part-00000000.aac'));
    await close(); await start(); await page.getByRole('heading', { name: 'Scrolling', exact: true }).waitFor(); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0);
    await manager(); assert.equal((await jobs()).find(job => job.id === pdfJob.id).status, 'paused'); const saved = JSON.parse(await readFile(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'job.json'), 'utf8')); assert.equal(saved.next, checkpoint.next); assert.equal(saved.samples, checkpoint.samples);
    assert.deepEqual(await readFile(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'encoding/part-00000000.aac')), compressedPrefix); assert.match(await page.locator(`[data-export-id="${pdfJob.id}"] small`).textContent(), /compressed and saved/);
  });
  await check('Resume continues after the saved phrase and retains the original PCM prefix', async () => {
    const filename = path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'audio.pcm'), prefix = (await readFile(filename)).subarray(0, 10000), row = page.locator(`[data-export-id="${pdfJob.id}"]`);
    await row.getByRole('button', { name: 'Resume export', exact: true }).click(); await until(async () => (await jobs()).find(job => job.id === pdfJob.id).next > checkpoint.next); await row.getByRole('button', { name: 'Pause export', exact: true }).click(); await waitJob(pdfJob.id, ['paused']); assert.deepEqual((await readFile(filename)).subarray(0, prefix.length), prefix);
    assert.deepEqual(await readFile(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'encoding/part-00000000.aac')), compressedPrefix);
    await page.screenshot({ path: path.join(output, 'resumed-job.png') });
  });
  await check('Manager filters, search, completed files and compact layout retain both exports', async () => {
    await page.getByRole('button', { name: 'Completed 1', exact: true }).click(); assert.equal(await page.locator('[data-export-id]').count(), 1);
    await app.evaluate(({ shell }) => { globalThis.__revealedExports = []; shell.showItemInFolder = filename => globalThis.__revealedExports.push(filename); });
    await page.getByRole('button', { name: 'Show audiobook in folder', exact: true }).click(); await until(async () => (await app.evaluate(() => globalThis.__revealedExports.length)) === 1); assert.equal((await app.evaluate(() => globalThis.__revealedExports))[0], epubJob.output);
    await rename(epubJob.output, epubJob.output + '.moved');
    try { await page.getByRole('button', { name: 'Show audiobook in folder', exact: true }).click(); const alert = page.getByRole('alert').filter({ hasText: 'file has moved' }); await alert.waitFor(); assert(!/reader:export|Error invoking/.test(await alert.textContent())); assert.equal(await page.locator('[data-export-id]').count(), 1); }
    finally { await rename(epubJob.output + '.moved', epubJob.output); }
    await page.getByRole('button', { name: 'Unfinished 1', exact: true }).click(); assert.equal(await page.locator('[data-export-id]').count(), 1); assert.equal(await page.locator('[data-export-id]').getAttribute('data-export-id'), pdfJob.id);
    await page.getByRole('button', { name: 'All 2', exact: true }).click(); await page.getByLabel('Search audio exports', { exact: true }).fill('  AUDIOBOOK QA  '); assert.equal(await page.locator('[data-export-id]').count(), 1);
    await page.getByLabel('Search audio exports', { exact: true }).fill('no matching book'); await page.getByRole('heading', { name: 'No matching exports', exact: true }).waitFor(); await page.getByLabel('Search audio exports', { exact: true }).fill(''); assert.equal(await page.locator('[data-export-id]').count(), 2);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700));
    const geometry = await page.locator('.export-manager-scroll').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, height: element.clientHeight, overflow: getComputedStyle(element).overflowY })); assert(geometry.scroll <= geometry.width + 1, JSON.stringify(geometry)); assert(geometry.height > 150 && geometry.overflow === 'auto');
    await page.screenshot({ path: path.join(output, 'manager-compact.png') }); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1480, 960));
  });
  await check('Closing during conversion automatically pauses it; history and source survive without an open book', async () => {
    await page.getByRole('button', { name: 'Back to reading', exact: true }).click(); await page.getByRole('button', { name: 'Close document', exact: true }).click(); await manager(); assert(await page.getByRole('button', { name: 'New export', exact: true }).isDisabled());
    const before = (await jobs()).find(job => job.id === pdfJob.id).next;
    await page.locator(`[data-export-id="${pdfJob.id}"]`).getByRole('button', { name: 'Resume export', exact: true }).click(); await until(async () => (await jobs()).find(job => job.id === pdfJob.id).next > before);
    await close(); checkpoint = JSON.parse(await readFile(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'job.json'), 'utf8')); assert.equal(checkpoint.status, 'paused'); assert(checkpoint.next > before);
    await start(); await page.getByRole('heading', { name: 'Scrolling', exact: true }).waitFor(); await manager(); const restored = await jobs(); assert.equal(restored.length, 2); assert.equal(restored.find(job => job.id === epubJob.id).status, 'complete'); assert.equal(restored.find(job => job.id === pdfJob.id).status, 'paused'); assert.equal(restored.find(job => job.id === pdfJob.id).next, checkpoint.next);
  });
  await check('An abruptly terminated test app restores the conversion paused with its audio prefix intact', async () => {
    const pcm = path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'audio.pcm'), prefix = (await readFile(pcm)).subarray(0, 10000), before = checkpoint.next;
    await page.locator(`[data-export-id="${pdfJob.id}"]`).getByRole('button', { name: 'Resume export', exact: true }).click(); await until(async () => (await jobs()).find(job => job.id === pdfJob.id).next > before);
    const process = app.process(), exited = new Promise(resolve => process.once('exit', resolve));
    // Stop the whole isolated app. Killing only Chromium's main PID leaves its renderer holding the profile lock.
    await new Promise((resolve, reject) => { const kill = spawn('taskkill.exe', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); kill.on('error', reject); kill.on('exit', code => code === 0 ? resolve() : reject(new Error('The isolated crash test could not stop its process tree.'))); });
    await exited; app = null;
    const saved = JSON.parse(await readFile(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'job.json'), 'utf8')); assert(saved.next > before); assert.deepEqual((await readFile(pcm)).subarray(0, prefix.length), prefix);
    assert.deepEqual(await readFile(path.join(env.CADENCE_DATA_DIR, 'audiobook-jobs', pdfJob.id, 'encoding/part-00000000.aac')), compressedPrefix);
    await start(); await page.getByRole('heading', { name: 'Scrolling', exact: true }).waitFor(); await manager(); assert.equal((await jobs()).find(job => job.id === pdfJob.id).status, 'paused'); await page.locator(`[data-export-id="${pdfJob.id}"]`).getByRole('button', { name: 'Resume export', exact: true }).waitFor(); await page.waitForTimeout(400); assert.equal((await jobs()).find(job => job.id === pdfJob.id).next, saved.next); assert.equal((await jobs()).find(job => job.id === epubJob.id).status, 'complete');
    await page.screenshot({ path: path.join(output, 'manager-after-abrupt-exit.png') });
  });
  await check('No renderer errors or external book/audio requests occur', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
} catch (error) { errors.push(error.stack); process.exitCode = 1; console.error(error); if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
finally { await close().catch(() => {}); await writeFile(path.join(output, 'native.log'), nativeLog); await writeFile(path.join(output, 'report.json'), JSON.stringify({ staged, checks, errors, external, nativeExits, output }, null, 2)); }
