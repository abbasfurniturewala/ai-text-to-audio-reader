import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { navigationPdf } from './navigation-fixture.mjs';
import { fivePagePdf } from './pdf-fixture.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = process.argv.includes('--staged'), key = 'cadence-reader-session-v1';
await mkdir('test-results/fixtures', { recursive: true });
await writeFile('test-results/fixtures/Resume book A.pdf', navigationPdf());
await writeFile('test-results/fixtures/Resume book B.pdf', navigationPdf({ count: 8 }));
await writeFile('test-results/fixtures/Resume blank page.pdf', fivePagePdf({ blankPage: 4 }));
await writeFile('test-results/fixtures/Resume text.txt', Array.from({ length: 80 }, (_, n) => `Paragraph ${n + 1}. ` + 'A reader follows the story through a long and interesting afternoon. '.repeat(5)).join('\n\n'));
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/resume-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const checks = [], errors = [];
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480, 960);
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async () => ({ samples: Float32Array.from({ length: 240000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }));
  });
}
async function stop() {
  if (!app) return;
  const closing = app.waitForEvent('close', { timeout: 15000 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closing; app = undefined;
}
async function restart(title, number, original = false) {
  await stop(); await start();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, number);
  assert.equal(await page.getByRole('button', { name: original ? 'Original PDF' : 'Reading view', exact: true }).getAttribute('class'), 'active');
  if (original) await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
  else await page.locator(`[data-location-key="page-${number}"][data-mounted="true"]`).waitFor();
}
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
async function upload(name) {
  await page.locator('input[type=file]').setInputFiles(`test-results/fixtures/${name}.pdf`);
  await page.getByRole('heading', { name, exact: true }).waitFor();
}
async function jump(number) {
  await page.getByLabel('Go to original page', { exact: true }).fill(String(number));
  await page.getByLabel('Go to original page', { exact: true }).press('Enter');
  await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, number);
}
async function session() { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), key); }
async function stored(key) {
  return page.evaluate(key => new Promise((resolve, reject) => {
    const open = indexedDB.open('keyval-store');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction('keyval'), request = tx.objectStore('keyval').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); tx.oncomplete = () => db.close(); };
  }), key);
}
try {
  await start();
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  let firstId, wantedSegment, firstBlobSize;
  await check('A full app restart restores the last PDF and browsed paragraph, independently of audio', async () => {
    await upload('Resume book A'); await jump(37);
    const target = page.locator('[data-location-key="page-37"] .passage').nth(5);
    wantedSegment = Number(await target.getAttribute('data-passage-index'));
    await target.evaluate(element => { const scroller = element.closest('.reader-scroll'); scroller.scrollTo({ top: scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12, behavior: 'instant' }); });
    await page.waitForFunction(({ key, wanted }) => { const saved = JSON.parse(localStorage.getItem(key)); return saved?.books[saved.lastId]?.segment === wanted; }, { key, wanted: wantedSegment });
    firstId = (await session()).lastId;
    firstBlobSize = (await stored(`cadence-file:${firstId}`)).size;
    await restart('Resume book A', 37);
    const restored = page.locator(`[data-passage-index="${wantedSegment}"]`);
    await page.waitForFunction(index => { const element = document.querySelector(`[data-passage-index="${index}"]`); return element && Math.abs(element.getBoundingClientRect().top - element.closest('.reader-scroll').getBoundingClientRect().top - 12) < 12; }, wantedSegment);
    const offset = await restored.evaluate(element => element.getBoundingClientRect().top - element.closest('.reader-scroll').getBoundingClientRect().top);
    assert.ok(Math.abs(offset - 12) < 12, `Restored paragraph offset ${offset}`);
    await page.getByText('Audio on page 1', { exact: true }).waitFor();
    assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
  });
  await check('Closing immediately after a page jump saves the new page', async () => {
    await jump(48);
    await restart('Resume book A', 48);
  });
  await check('Original PDF mode and its page survive a complete relaunch', async () => {
    await page.getByRole('button', { name: 'Original PDF', exact: true }).click();
    await jump(44);
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await page.locator('.reader-scroll').evaluate(element => element.scrollTo({ top: 300, behavior: 'instant' }));
    await restart('Resume book A', 44, true);
    assert.ok(await page.locator('.reader-scroll').evaluate(element => element.scrollTop) < 3);
  });
  await check('Pending audio/bookmark saves finish on close without replacing the browsed page', async () => {
    await page.getByRole('button', { name: 'Reading view', exact: true }).click();
    await jump(2);
    await page.locator('[data-location-key="page-2"] .passage').first().click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByLabel('Pause narration', { exact: true }).click();
    await jump(32);
    await page.getByLabel('Bookmark current passage', { exact: true }).click();
    await restart('Resume book A', 32);
    await page.getByText('Audio on page 2', { exact: true }).waitFor();
    const item = (await stored('cadence-library-index-v2')).find(item => item.id === firstId);
    assert.equal(item.bookmarks.length, 1);
    assert.ok(item.position > 0);
  });
  await check('Multiple books remain on the shelf and each keeps a small separate checkpoint', async () => {
    await upload('Resume book B'); await jump(7);
    await restart('Resume book B', 7);
    const index = await stored('cadence-library-index-v2');
    assert.deepEqual(index.map(item => item.title).sort(), ['Resume book A', 'Resume book B', 'The art of paying attention'].sort());
    await page.locator('.recent-document').filter({ hasText: 'Resume book A' }).click();
    await page.getByRole('heading', { name: 'Resume book A', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-32');
    assert.equal((await stored(`cadence-file:${firstId}`)).size, firstBlobSize);
    const raw = await page.evaluate(key => localStorage.getItem(key), key);
    assert.ok(raw.length < 2048);
    assert.ok(!raw.includes('On page') && !raw.includes('samples') && !raw.includes('bytes'));
  });
  await check('Closing a document or leaving for the library does not lose the last book on restart', async () => {
    await page.getByLabel('Close document', { exact: true }).click();
    await page.getByRole('heading', { name: 'Your words. Your rhythm.', exact: true }).waitFor();
    await restart('Resume book A', 32);
    await page.getByRole('button', { name: /^My library/ }).click();
    await restart('Resume book A', 32);
  });
  await check('Blank PDF pages restore correctly and deleted books are never reopened', async () => {
    await upload('Resume blank page'); await jump(4);
    await restart('Resume blank page', 4);
    await page.getByText('This page has no selectable text.', { exact: true }).waitFor();
    const removedId = (await session()).lastId;
    await page.getByLabel('Remove current document', { exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Document removed from your library' }).waitFor();
    await restart('Resume book A', 32);
    assert.equal((await stored('cadence-library-index-v2')).some(item => item.id === removedId), false);
    assert.equal((await session()).books[removedId], undefined);
  });
  await check('Text documents restore their section and paragraph across relaunch', async () => {
    await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Resume text.txt');
    await page.getByRole('heading', { name: 'Resume text', exact: true }).waitFor();
    await page.getByLabel('Go to section', { exact: true }).fill('9');
    await page.getByLabel('Go to section', { exact: true }).press('Enter');
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-9');
    await stop(); await start();
    await page.getByRole('heading', { name: 'Resume text', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-9');
    assert.equal(await app.evaluate(({ app }) => app.hasSingleInstanceLock()), true);
    assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/resume-reader.png' });
  await writeFile('test-results/resume-results.json', JSON.stringify({ checks, errors, staged, dataDirectory: env.CADENCE_DATA_DIR }, null, 2));
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: 'test-results/resume-failure.png' }); throw error; }
finally { await stop(); }
