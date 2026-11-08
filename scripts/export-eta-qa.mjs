import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const staged = process.argv.includes('--staged'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = path.resolve(`test-results/export-eta/${staged ? 'staged' : 'source'}-${Date.now()}`); await mkdir(output, { recursive: true });
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
const fixture = { id: 'eta-fixture', title: 'Live completion estimate', engine: 'kokoro-cuda', voiceName: 'Echo', output: path.join(output, 'fixture.m4b'), created: Date.now(), status: 'running', message: 'Creating audio.', progress: 10, audioSeconds: 120, chapterCount: 3, estimatedWorkingBytes: 0, completedCharacters: 1000, totalCharacters: 2000000, encodedSamples: 60 * 24000 };
let app, page; const checks = [], errors = [], external = [];
async function publish(values) { await app.evaluate(({ BrowserWindow }, values) => { Object.assign(globalThis.__etaFixture, values); BrowserWindow.getAllWindows()[0].webContents.send('reader:export-progress', { job: globalThis.__etaFixture }); }, values); }
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
try {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 }); page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', reason => errors.push(reason.message)); page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await app.evaluate(({ ipcMain, BrowserWindow }, fixture) => { globalThis.__etaFixture = fixture; ipcMain.removeHandler('reader:export-list'); ipcMain.handle('reader:export-list', () => [globalThis.__etaFixture]); BrowserWindow.getAllWindows()[0].setContentSize(1100, 760); BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true); }, fixture);
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor(); await menuClick(page.getByRole('button', { name: 'Audio exports', exact: true }));
  const row = page.locator('[data-export-id="eta-fixture"]'), eta = row.getByLabel('Estimated completion', { exact: true });
  await check('Conversion waits for measured progress, then shows live time remaining and finish time under the percentage', async () => {
    await eta.getByText('Estimating…', { exact: true }).waitFor(); await page.waitForTimeout(2300); await publish({ completedCharacters: 2000, audioSeconds: 240, encodedSamples: 120 * 24000, progress: 20 }); await eta.locator('time').waitFor(); assert.match(await eta.textContent(), /About .*leftFinish ~/);
    const geometry = await row.locator('.export-job-numbers').evaluate(element => { const percent = element.querySelector('b').getBoundingClientRect(), eta = element.querySelector('.export-eta').getBoundingClientRect(); return { percentBottom: percent.bottom, etaTop: eta.top, rightDifference: Math.abs(percent.right - eta.right) }; }); assert(geometry.etaTop >= geometry.percentBottom && geometry.rightDifference < 1);
  });
  await check('The countdown advances without progress events and new measured speed revises the finish estimate', async () => {
    const before = Date.parse(await eta.locator('time').getAttribute('datetime')); await page.waitForTimeout(2300); assert(Math.abs(Date.parse(await eta.locator('time').getAttribute('datetime')) - before) < 10);
    await publish({ completedCharacters: 2100, audioSeconds: 252, encodedSamples: 121 * 24000, progress: 21 }); await page.waitForFunction(before => Date.parse(document.querySelector('.export-eta time')?.dateTime || '') > before + 1000, before);
    await page.screenshot({ path: path.join(output, 'live-eta.png') });
  });
  await check('Long estimates fit a compact window and retain the existing export actions', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700)); const geometry = await page.locator('.export-manager-scroll').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth })); assert(geometry.scroll <= geometry.client + 1); assert(await row.getByRole('button', { name: 'Pause export', exact: true }).isEnabled()); await page.screenshot({ path: path.join(output, 'compact-eta.png') });
  });
  await check('Pause and model preparation remove deadlines; resume measures a fresh run', async () => {
    await publish({ status: 'paused' }); await eta.getByText('Paused · ETA on resume', { exact: true }).waitFor(); assert.equal(await eta.locator('time').count(), 0);
    await publish({ status: 'loading' }); await eta.getByText('Estimating…', { exact: true }).waitFor(); await publish({ status: 'running' }); await eta.getByText('Estimating…', { exact: true }).waitFor(); assert.equal(await eta.locator('time').count(), 0);
  });
  await check('File compression and assembly use their own measured ETA in the same location', async () => {
    for (const phase of ['encoding', 'assembling']) { const now = Date.now(); await publish({ status: 'encoding', finishing: { phase, startedAt: now - 10000, updatedAt: now, percent: 30, encodedSeconds: 30, totalSeconds: 100, remainingSeconds: 70 } }); await eta.getByText('About 2m left', { exact: true }).waitFor(); assert.match(await eta.locator('time').textContent(), /^Finish ~/); }
  });
  await check('Final checks, indexing and saving never pretend to have a reliable countdown', async () => {
    for (const [phase, label] of [['checking', 'Final checks…'], ['indexing', 'Writing chapters…'], ['saving', 'Saving…']]) { await publish({ finishing: { phase, startedAt: Date.now(), updatedAt: Date.now() } }); await eta.getByText(label, { exact: true }).waitFor(); assert.equal(await eta.locator('time').count(), 0); }
  });
  await check('Stale and expired file estimates disappear; completed and failed history has no countdown', async () => {
    await publish({ finishing: { phase: 'encoding', startedAt: Date.now() - 120000, updatedAt: Date.now() - 100000, remainingSeconds: 300 } }); await eta.getByText('Estimating…', { exact: true }).waitFor(); assert.equal(await eta.locator('time').count(), 0);
    await publish({ finishing: { phase: 'assembling', startedAt: Date.now(), updatedAt: Date.now(), remainingSeconds: 1 } }); await eta.locator('time').waitFor(); await eta.getByText('Estimating…', { exact: true }).waitFor();
    await publish({ status: 'complete', progress: 100 }); await eta.waitFor({ state: 'hidden' }); assert.equal(await row.locator('.export-job-numbers b').textContent(), '100%'); await publish({ status: 'error' }); assert.equal(await eta.count(), 0);
  });
  await check('Removed-model history remains visible without an ETA or unsafe cross-model resume', async () => {
    for (const engine of ['chatterbox-cuda', 'chatterbox-standard-cuda']) { await publish({ engine, status: 'paused' }); await row.getByText('Model removed', { exact: true }).waitFor(); assert(await row.getByRole('button', { name: 'Resume export', exact: true }).isDisabled()); assert.equal(await eta.count(), 0); assert.match(await row.getByRole('status').textContent(), /Saved audio and history are retained/); }
    await publish({ status: 'complete' }); await row.getByRole('button', { name: 'Show audiobook in folder', exact: true }).waitFor(); assert(await row.getByRole('button', { name: 'Show audiobook in folder', exact: true }).isEnabled()); assert.equal(await row.locator('.export-job-meta').getByText(/CPU Kokoro/).count(), 0);
  });
  await check('No renderer errors, unwanted playback or external book/audio requests occur', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0); });
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1; if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
finally { await app?.close().catch(() => {}); await writeFile(path.join(output, 'report.json'), JSON.stringify({ staged, output, checks, errors, external, syntheticProgress: true }, null, 2)); }
