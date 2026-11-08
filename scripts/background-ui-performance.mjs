import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { navigationPdf } from './navigation-fixture.mjs';
import { menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = path.resolve('test-results/background-encoding/visible-' + Date.now()), profile = path.join(output, 'profile'); await mkdir(output, { recursive: true });
const env = { ...process.env, CADENCE_DATA_DIR: profile, CADENCE_QA_OFFLINE: '1' }; delete env.CADENCE_QA; delete env.CADENCE_DEV_URL; delete env.ELECTRON_RUN_AS_NODE;
await writeFile(path.join(output, 'Performance fixture.pdf'), navigationPdf({ count: 40 }));
let app, page, job, native = ''; const errors = [], external = [], report = { output, liveProfileAccess: false, muted: true };
const jobs = () => page.evaluate(() => window.cadence.exportJobs());
async function until(predicate, timeout = 90000) { const end = Date.now() + timeout; while (true) { const result = await predicate(); if (result) return result; assert(Date.now() < end, 'The visible performance test did not settle.'); await page.waitForTimeout(100); } }
try {
  app = await _electron.launch({ executablePath: path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`), env, timeout: 60000 });
  app.process().stderr.on('data', data => native = (native + data).slice(-50000)); page = await app.firstWindow(); page.setDefaultTimeout(25000);
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  report.window = await app.evaluate(({ app, BrowserWindow }, output) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1480, 960); window.setTitle('Cadence — isolated performance test'); window.webContents.setAudioMuted(true); return { userData: app.getPath('userData'), offscreen: window.webContents.isOffscreen(), visible: window.isVisible(), gpu: app.getGPUFeatureStatus() }; }, output);
  assert.equal(path.resolve(report.window.userData), profile); assert.equal(report.window.offscreen, false); assert.equal(report.window.visible, true);
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.evaluate(() => { document.title = 'Cadence — isolated performance test'; });
  await page.locator('input[type=file]').setInputFiles(path.join(output, 'Performance fixture.pdf')); await page.getByRole('heading', { name: 'Performance fixture', exact: true }).waitFor(); await page.getByRole('button', { name: 'Document view', exact: true }).click();
  await menuClick(page.getByRole('button', { name: 'Audio exports', exact: true })); await page.getByRole('button', { name: 'New export', exact: true }).click();
  const runtime = await page.evaluate(() => window.cadence.exportRuntime()); assert(runtime.tools && runtime.kokoroGpu); await page.getByLabel('Export model', { exact: true }).selectOption('kokoro-cuda');
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, path.join(output, 'book.m4b'));
  await page.getByRole('button', { name: 'Create M4B audiobook', exact: true }).click(); job = await until(async () => (await jobs())[0]);
  await until(async () => { const current = (await jobs())[0]; assert.notEqual(current.status, 'error', current.message); return current.status === 'running' && current.encodedSamples > 0; });
  const exporting = (await jobs())[0]; report.exportDevice = exporting.device; report.exportProvider = exporting.provider;
  await page.getByRole('button', { name: 'Back to reading', exact: true }).click();
  const show = page.getByRole('button', { name: 'Show playback controls', exact: true }); if (await show.isVisible()) await show.click(); await page.getByLabel('Play narration', { exact: true }).click(); await page.getByLabel('Pause narration', { exact: true }).waitFor();
  const box = await page.locator('.reader-scroll').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  report.compressedBefore = (await jobs())[0].encodedSamples;
  const measuring = page.evaluate(() => new Promise(resolve => {
    const frames = [], longTasks = []; let before = performance.now(), count = 0;
    const observer = new PerformanceObserver(list => { for (const item of list.getEntries()) longTasks.push(item.duration); }); observer.observe({ entryTypes: ['longtask'] });
    const step = now => { frames.push(now - before); before = now; if (++count < 3600) requestAnimationFrame(step); else { observer.disconnect(); resolve({ frames, longTasks, max: Math.max(...frames), p95: [...frames].sort((a, b) => a - b)[3420], over50: frames.filter(value => value > 50).length }); } }; requestAnimationFrame(step);
  }));
  for (let i = 0; i < 100; i++) { await page.mouse.wheel(0, i % 40 < 24 ? 120 : -120); await page.waitForTimeout(500); }
  report.frames = await measuring; report.compressedAfter = (await jobs())[0].encodedSamples; report.browsingPage = Number(await page.locator('.pdf-document').getAttribute('data-page'));
  assert(report.compressedAfter > report.compressedBefore); assert(report.browsingPage > 1); assert(await page.getByLabel('Pause narration', { exact: true }).count());
  assert(report.frames.max < 250 && report.frames.p95 < 40 && report.frames.over50 < 18, JSON.stringify(report.frames));
  await page.screenshot({ path: path.join(output, 'visible-reader.png') });
  const reveal = page.getByRole('button', { name: 'Show playback controls', exact: true }); if (await reveal.isVisible()) await reveal.click(); await page.getByLabel('Pause narration', { exact: true }).click();
  await page.evaluate(id => window.cadence.controlExport(id, 'pause'), job.id); assert.equal((await jobs())[0].status, 'paused');
  const prefix = await readFile(path.join(profile, 'audiobook-jobs', job.id, 'encoding/part-00000000.aac')); report.prefixHash = createHash('sha256').update(prefix).digest('hex');
  assert.deepEqual(errors, []); assert.deepEqual(external, []); report.passed = true; console.log('PASS Normal visible Windows rendering, reader narration, GPU export and background compression remain responsive for 3600 frames');
} catch (error) { errors.push(error.stack); process.exitCode = 1; console.error(error); if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
finally { if (app) { const closed = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {}); await closed; } await writeFile(path.join(output, 'native.log'), native); await writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, errors, external }, null, 2)); console.log(JSON.stringify({ output, passed: report.passed, max: report.frames?.max, p95: report.frames?.p95, over50: report.frames?.over50, offscreen: report.window?.offscreen })); }
