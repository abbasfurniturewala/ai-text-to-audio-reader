import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { waitReaderWordVisible, menuClick } from './reader-qa-helpers.mjs';
import { navigationPdf } from './navigation-fixture.mjs';
import { fivePagePdf } from './pdf-fixture.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = process.argv.includes('--staged'), baseline = process.argv.includes('--baseline'), key = 'cadence-reader-session-v1';
await mkdir('test-results/fixtures', { recursive: true });
await writeFile('test-results/fixtures/Resume book A.pdf', navigationPdf());
await writeFile('test-results/fixtures/Resume book B.pdf', navigationPdf({ count: 8 }));
await writeFile('test-results/fixtures/Resume blank page.pdf', fivePagePdf({ blankPage: 4 }));
await writeFile('test-results/fixtures/Resume text.txt', Array.from({ length: 80 }, (_, n) => `Paragraph ${n + 1}. ` + 'A reader follows the story through a long and interesting afternoon. '.repeat(5)).join('\n\n'));
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/resume-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
let app, page, appProcess;
const checks = [], errors = []; let nativeErrors = '';
async function start() {
  app = await _electron.launch({ executablePath: staged || baseline ? path.resolve(staged ? `release/staged-${version}/win-unpacked/Cadence.exe` : 'release/win-unpacked/Cadence.exe') : require('electron'), args: staged || baseline ? [] : ['.'], env, timeout: 60000 });
  appProcess = app.process(); appProcess.stderr?.on('data', data => { nativeErrors = (nativeErrors + data).slice(-20000); });
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
  const process = appProcess;
  if (process.exitCode !== null) { app = undefined; assert.equal(process.exitCode, 0); return; }
  let timer;
  const closing = new Promise((resolve, reject) => { process.once('exit', code => resolve(code)); timer = setTimeout(() => reject(new Error('Cadence did not exit within 15 seconds')), 15000); });
  void closing.catch(() => {});
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(error => { if (!/closed|garbage collected/.test(error.message)) throw error; });
    const code = await closing; app = undefined; assert.equal(code, 0);
  } finally { clearTimeout(timer); }
}
async function restart(title, number, original = false) {
  await stop(); await start();
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, number);
  assert.equal(await page.getByRole('button', { name: original ? 'Document view' : 'Reading view', exact: true }).getAttribute('class'), 'active');
  if (original) await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
  else await page.locator(`[data-location-key="page-${number}"][data-mounted="true"]`).waitFor();
}
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
async function singleInstanceLock() {
  for (let attempt = 0; ; attempt++) {
    try { return await app.evaluate(({ app }) => app.hasSingleInstanceLock()); }
    catch (error) { if (attempt >= 2 || appProcess.exitCode !== null || !/Resulting promise was garbage collected/.test(error.message)) throw error; }
  }
}
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
    await page.locator('.reader-scroll').hover(); await page.mouse.wheel(0, 1);
    await target.evaluate(element => { const scroller = element.closest('.reader-scroll'), marker = element.closest('section').querySelector('.original-page-marker'); const inset = marker.getBoundingClientRect().height + parseFloat(getComputedStyle(scroller).paddingTop) + parseFloat(getComputedStyle(marker).top) + 16; scroller.scrollTo({ top: scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - inset, behavior: 'instant' }); });
    await page.waitForFunction(({ key, wanted }) => { const saved = JSON.parse(localStorage.getItem(key)); return saved?.books[saved.lastId]?.segment === wanted; }, { key, wanted: wantedSegment });
    firstId = (await session()).lastId;
    firstBlobSize = (await stored(`cadence-file:${firstId}`)).size;
    await restart('Resume book A', 37);
    const restored = page.locator(`[data-passage-index="${wantedSegment}"]`);
    await waitReaderWordVisible(restored, 4, 28);
    assert.ok(await restored.isVisible());
    await page.getByText('Audio on page 1', { exact: true }).waitFor();
    assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
  });
  await check('Closing immediately after a page jump saves the new page', async () => {
    await jump(48);
    await restart('Resume book A', 48);
  });
  await check('Original PDF mode and its page survive a complete relaunch', async () => {
    await page.getByRole('button', { name: 'Document view', exact: true }).click();
    await jump(44);
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await page.locator('.pdf-page-slot[data-current="true"]').evaluate(element => { const scroller = element.closest('.reader-scroll'); scroller.scrollTo({ top: scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 300, behavior: 'instant' }); });
    await restart('Resume book A', 44, true);
    assert.ok(await page.locator('[data-pdf-page="44"]').evaluate(element => { const toolbar = element.closest('.reader-scroll').querySelector('.pdf-pagination').getBoundingClientRect(); return Math.abs(element.getBoundingClientRect().top - toolbar.bottom - 12) < 12; }));
  });
  await check('Pending audio/bookmark saves finish on close without replacing the browsed page', async () => {
    await page.getByRole('button', { name: 'Reading view', exact: true }).click();
    await jump(2);
    await page.locator('[data-location-key="page-2"] .passage').first().click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByLabel('Pause narration', { exact: true }).click();
    await jump(32);
    await page.getByLabel('Bookmark audio position', { exact: true }).click();
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
    await menuClick(page.locator('.recent-document').filter({ hasText: 'Resume book A' }));
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
    await menuClick(page.getByRole('button', { name: /^My library/ }));
    await restart('Resume book A', 32);
  });
  await check('Blank PDF pages restore correctly and deleted books are never reopened', async () => {
    await upload('Resume blank page'); await jump(4);
    await restart('Resume blank page', 4);
    await page.getByText('This page has no selectable text.', { exact: true }).waitFor();
    const removedId = (await session()).lastId;
    await page.getByLabel('Remove current document', { exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
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
    assert.equal(await singleInstanceLock(), true);
    assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'test-results/resume-reader.png' });
  await writeFile('test-results/resume-results.json', JSON.stringify({ checks, errors, staged, dataDirectory: env.CADENCE_DATA_DIR }, null, 2));
} catch (error) { console.error(error.stack, nativeErrors); if (page && !page.isClosed()) { await page.screenshot({ path: 'test-results/resume-failure.png' }).catch(() => {}); console.log('Resume geometry:', await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('cadence-reader-session-v1')), point = saved?.books[saved.lastId], element = document.querySelector(`[data-passage-index="${point?.segment}"]`), marker = element?.closest('section')?.querySelector('.original-page-marker'), word = element?.querySelector('[data-reader-text]'), box = word?.getBoundingClientRect(); return { point, target: element?.getBoundingClientRect(), marker: marker?.getBoundingClientRect(), scroller: element?.closest('.reader-scroll')?.getBoundingClientRect(), hit: box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.outerHTML.slice(0, 180) }; }).catch(() => 'Reader process already exited')); } throw error; }
finally { await stop(); }
