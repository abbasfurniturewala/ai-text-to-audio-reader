import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord, readerSpeechText, waitReaderWordVisible, menuClick, openMenu } from './reader-qa-helpers.mjs';
import { fivePagePdf } from './pdf-fixture.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version, staged = process.argv.includes('--staged');
const output = path.resolve('test-results/ui-improvements'); await mkdir(output, { recursive: true });
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
let app, page; const checks = [], errors = [];
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  if (process.argv.includes('--trace')) await page.evaluate(() => { window.__uiScroll = []; const native = HTMLElement.prototype.scrollTo; HTMLElement.prototype.scrollTo = function (...args) { if (this.matches('.reader-scroll')) { const target = this.querySelector('[data-passage-index="24"]'), marker = target?.closest('section')?.querySelector('.original-page-marker'); window.__uiScroll.push({ at: performance.now(), args, before: this.scrollTop, target: target?.getBoundingClientRect().top, marker: marker ? { top: marker.getBoundingClientRect().top, height: marker.getBoundingClientRect().height, position: getComputedStyle(marker).position, mounted: marker.closest('section').dataset.mounted } : null }); if (window.__uiScroll.length > 80) window.__uiScroll.shift(); } return native.apply(this, args); }; });
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480, 960); globalThis.__uiRequests = [];
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__uiRequests.push(request);
      return { samples: Float32Array.from({ length: 240000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
}
async function close() { if (!app) return; const closing = app.waitForEvent('close'); try { await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 50); }); } catch (error) { if (!/garbage collected|closed/.test(error.message)) throw error; } await closing; app = undefined; }
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function stored(key = 'cadence-library-index-v2') { return page.evaluate(key => new Promise(resolve => { const request = indexedDB.open('keyval-store'); request.onsuccess = () => { const db = request.result, tx = db.transaction('keyval'), value = tx.objectStore('keyval').get(key); value.onsuccess = () => resolve(value.result); tx.oncomplete = () => db.close(); }; }), key); }
async function jump(number) { const input = page.getByLabel('Go to original page', { exact: true }); await input.fill(String(number)); await input.press('Enter'); await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, number); }
async function pause() { await page.mouse.move(15, 15); await page.getByLabel('Pause narration', { exact: true }).click(); }
async function unobscured(locator) { return locator.evaluate(element => { const bounds = element.getBoundingClientRect(), hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); return !!hit && element.contains(hit); }); }
async function note(title) { await menuClick(page.getByLabel('Paste text', { exact: true })); await page.getByLabel('Document title', { exact: true }).fill(title); await page.getByLabel('Your text', { exact: true }).fill('A synthetic note keeps all of its saved words and bookmarks when removal is undone.'); await page.getByRole('button', { name: 'Add to my library' }).click(); await page.getByRole('heading', { name: title, exact: true }).waitFor(); }
try {
  await start(); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await check('Restored reading headings remain visible and clickable below the sticky marker', async () => {
    await page.waitForTimeout(600); await waitReaderWordVisible(page.locator('[data-passage-index="0"]'));
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'UI Review.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fivePagePdf({ labels: true, outline: true })) });
  await page.getByRole('heading', { name: 'UI Review', exact: true }).waitFor();
  const bookId = (await stored()).find(book => book.title === 'UI Review').id;
  await check('Slate-blue controls have readable contrast, larger labels and larger hit areas', async () => {
    const styles = await page.getByRole('button', { name: 'Go to audio', exact: true }).evaluate(element => {
      const style = getComputedStyle(element), background = getComputedStyle(element.closest('.reader-navigation-bar')).backgroundColor;
      const lum = rgb => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126,.7152,.0722][i], 0);
      const a = lum(style.color), b = lum(background); return { contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), font: parseFloat(style.fontSize), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent') };
    });
    assert.ok(styles.contrast >= 4.5, JSON.stringify(styles)); assert.ok(styles.font >= 11); assert.equal(styles.accent.trim(), '#245c9f');
    for (const name of ['Smaller text', 'Larger text']) { const box = await page.getByLabel(name, { exact: true }).boundingBox(); assert.ok(box.width >= 28 && box.height >= 28); }
    await openMenu(page); const paste = await page.getByLabel('Paste text', { exact: true }).boundingBox(); assert.ok(paste.width >= 28 && paste.height >= 28); await page.keyboard.press('Escape');
    const notification = page.getByLabel('Dismiss notification', { exact: true }); if (await notification.isVisible()) await notification.click();
    await page.mouse.move(19,19); await page.screenshot({ path: path.join(output, staged ? 'staged-slate-reader.png' : 'source-slate-reader.png') });
  });
  await check('Library filtering never leaks into the current book as an invisible document filter', async () => {
    await menuClick(page.getByRole('button', { name: /^My library/ })); await page.getByLabel('Search library', { exact: true }).fill('UI Review'); await page.locator('.document-card-main').first().click();
    await page.locator('.passage').first().waitFor(); assert.ok(await page.locator('.passage').count() > 0); assert.equal(await page.locator('.empty-message').count(), 0);
  });
  await check('Space pauses and resumes exact-word playback without restarting the paragraph', async () => {
    await clickReaderWord(page.locator('.passage').first(), 'calm'); await page.getByLabel('Pause narration', { exact: true }).waitFor();
    const words = await readerSpeechText(page); assert.ok(words.join('').startsWith('calm'));
    await page.keyboard.press('Space'); await page.getByLabel('Play narration', { exact: true }).waitFor(); assert.deepEqual(await readerSpeechText(page), words);
    await page.keyboard.press('Space'); await page.getByLabel('Pause narration', { exact: true }).waitFor(); assert.deepEqual(await readerSpeechText(page), words); await pause();
  });
  await check('Viewed bookmarks and audio bookmarks stay distinct and bookmark cards reveal their destination', async () => {
    await jump(4); await page.getByLabel('Bookmark viewed passage', { exact: true }).click(); await page.waitForTimeout(500);
    let book = (await stored()).find(book => book.id === bookId); assert.equal(book.bookmarkPreviews[book.bookmarks[0]].page, 4);
    await jump(2); await menuClick(page.getByRole('button', { name: /^Bookmarks/ })); await page.locator('.bookmark-card').first().click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4');
    await waitReaderWordVisible(page.locator(`[data-passage-index="${book.bookmarks[0]}"]`));
    for (let repeat = 0; repeat < 3; repeat++) { await jump(2); await menuClick(page.getByRole('button', { name: /^Bookmarks/ })); await page.locator('.bookmark-card').first().click(); await waitReaderWordVisible(page.locator(`[data-passage-index="${book.bookmarks[0]}"]`)); }
    assert.ok((await page.locator('.audio-navigation>span').innerText()).includes('page 1'));
    await page.getByLabel('Bookmark audio position', { exact: true }).click(); await page.waitForTimeout(500); book = (await stored()).find(book => book.id === bookId);
    assert.deepEqual(book.bookmarks.map(index => book.bookmarkPreviews[index].page).sort(), [1,4]);
  });
  await check('Typeface and text size persist while retaining the browsed PDF page', async () => {
    await page.getByLabel('Larger text', { exact: true }).click(); await page.getByLabel('Larger text', { exact: true }).click(); await page.getByLabel('Change typeface', { exact: true }).click();
    await page.reload(); await page.getByRole('heading', { name: 'UI Review', exact: true }).waitFor(); await page.locator('.reading-paper.sans').waitFor();
    assert.equal(await page.locator('.reading-paper').evaluate(element => getComputedStyle(element).getPropertyValue('--reader-size')), '21px');
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4');
  });
  await check('Original PDF zoom resizes the actual page and preserves exact-word mapping', async () => {
    await page.getByRole('button', { name: 'Document view', exact: true }).click(); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    assert.equal(await page.getByLabel('Change typeface', { exact: true }).count(), 0);
    const width = await page.locator('.pdf-page-slot[data-current="true"] canvas').evaluate(element => element.clientWidth);
    await page.getByLabel('PDF zoom', { exact: true }).selectOption('1.5'); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    assert.ok(await page.locator('.pdf-page-slot[data-current="true"] canvas').evaluate(element => element.clientWidth) > width * 1.4);
    const point = await page.locator('.pdf-text-layer span').filter({ hasText: 'On page 4 passage 1' }).evaluate(element => { const at = element.textContent.indexOf('calm'), range = new Range(); range.setStart(element.firstChild, at); range.setEnd(element.firstChild, at + 4); const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; });
    await page.mouse.click(point.x, point.y); await page.getByLabel('Pause narration', { exact: true }).waitFor(); await pause();
    assert.ok((await app.evaluate(() => globalThis.__uiRequests)).some(request => request.text.startsWith('calm story')));
  });
  await check('PDF search reveals exact matches on other pages and cycles through results without moving audio', async () => {
    await page.getByLabel('PDF zoom', { exact: true }).selectOption('1'); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await page.getByLabel('Search document', { exact: true }).click(); await page.getByLabel('Search document text', { exact: true }).fill('On page 5 passage 7');
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-5');
    await page.waitForFunction(() => [...(CSS.highlights.get('cadence-pdf-match') || [])].map(range => range.toString()).join('') === 'On page 5 passage 7');
    await page.getByLabel('Search document text', { exact: true }).fill('passage 7'); await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-1');
    await page.getByLabel('Next search match', { exact: true }).click(); await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-2');
    assert.ok((await page.locator('.audio-navigation>span').innerText()).includes('page 4')); await page.screenshot({ path: path.join(output, staged ? 'staged-pdf-search.png' : 'source-pdf-search.png') });
    await page.getByLabel('Close search', { exact: true }).click(); assert.equal(await page.evaluate(() => CSS.highlights.has('cadence-pdf-search')), false);
  });
  await check('Undo restores original PDF bytes, text, bookmarks and the saved reader', async () => {
    const size = (await stored('cadence-file:' + bookId)).size;
    await page.getByLabel('Remove current document', { exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
    assert.equal((await stored('cadence-file:' + bookId)).size, size); await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.getByRole('heading', { name: 'UI Review', exact: true }).waitFor(); assert.equal((await stored()).find(book => book.id === bookId).bookmarks.length, 2);
    assert.equal((await stored('cadence-file:' + bookId)).size, size);
  });
  await check('Full-screen original PDF zoom and search remain usable without moving audio', async () => {
    await page.getByLabel('Enter full screen', { exact: true }).click(); await page.locator('.app-shell.focus-mode').waitFor(); await page.waitForTimeout(350);
    const rail = page.locator('.focus-controls');
    await rail.getByLabel('PDF zoom', { exact: true }).selectOption('1.25'); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await rail.getByLabel('Search document', { exact: true }).click(); await page.getByLabel('Search document text', { exact: true }).fill('On page 3 passage 4');
    await page.waitForFunction(() => [...(CSS.highlights.get('cadence-pdf-match') || [])].map(range => range.toString()).join('') === 'On page 3 passage 4');
    const visible = await page.evaluate(() => { const range = [...CSS.highlights.get('cadence-pdf-match')][0], box = range.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right < innerWidth - 90; });
    assert.equal(visible, true); assert.equal(await rail.getByLabel('PDF zoom', { exact: true }).inputValue(), '1.25');
    await page.getByLabel('Close search', { exact: true }).click(); await rail.getByLabel('Exit full screen', { exact: true }).click(); await page.locator('.app-shell:not(.focus-mode)').waitFor(); await page.waitForTimeout(350);
    assert.ok((await page.locator('.audio-navigation>span').innerText()).includes('page 4'));
  });
  await check('Dismiss finalizes removal and a timed Undo window expires without retaining book records', async () => {
    await page.getByLabel('Remove current document', { exact: true }).click(); await page.getByLabel('Dismiss removal notification', { exact: true }).click(); assert.equal(await stored('cadence-file:' + bookId), undefined);
    await note('Expiry note'); const id = (await stored()).find(book => book.title === 'Expiry note').id; await page.getByLabel('Remove current document', { exact: true }).click();
    await page.getByRole('button', { name: 'Undo', exact: true }).waitFor(); await page.getByRole('button', { name: 'Undo', exact: true }).waitFor({ state: 'hidden', timeout: 12000 });
    const deadline = Date.now() + 15000;
    while (await stored('cadence-text:' + id) !== undefined) { assert(Date.now() < deadline, 'Expired removal retained its text record'); await page.waitForTimeout(50); }
  });
  await check('Expanded voice blending remains reachable in a short window and renderer scaling keeps essentials visible', async () => {
    await menuClick(page.locator('.recent-document').filter({ hasText: 'The art of paying attention' })); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700)); await page.waitForTimeout(250);
    await page.locator('.voice-blender summary').click(); await page.getByRole('button', { name: 'Use blend', exact: true }).scrollIntoViewIfNeeded(); assert.equal(await unobscured(page.getByRole('button', { name: 'Use blend', exact: true })), true);
    assert.equal(await unobscured(page.getByLabel('Close voice panel', { exact: true })), true); await page.locator('.voice-blender summary').click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25)); await page.waitForTimeout(250);
    const fits = await page.locator('.player .play-button').evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }); assert.equal(fits, true);
    await menuClick(page.getByRole('button', { name: 'Settings', exact: true })); await page.getByRole('dialog').waitFor(); await page.getByLabel('Close dialog', { exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setZoomFactor(1); window.setContentSize(1480,960); });
  });
  await check('A second removal commits the previous book while Undo restores only the latest book', async () => {
    await note('First removal note'); const first = (await stored()).find(book => book.title === 'First removal note').id;
    await note('Second removal note'); const second = (await stored()).find(book => book.title === 'Second removal note').id;
    await menuClick(page.getByLabel('Remove First removal note from shelf', { exact: true })); await page.getByRole('button', { name: 'Undo', exact: true }).waitFor();
    await page.getByLabel('Remove current document', { exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Removed “Second removal note”' }).waitFor();
    assert.equal(await stored('cadence-text:' + first), undefined); assert.ok(await stored('cadence-text:' + second));
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.getByRole('heading', { name: 'Second removal note', exact: true }).waitFor();
    const titles = (await stored()).map(book => book.title); assert.ok(!titles.includes('First removal note')); assert.ok(titles.includes('Second removal note'));
  });
  await check('Closing the app finalizes pending removals and restart retains the slate reader and font preferences', async () => {
    await note('Close pending note'); const id = (await stored()).find(book => book.title === 'Close pending note').id;
    await page.getByLabel('Remove current document', { exact: true }).click(); await page.getByRole('button', { name: 'Undo', exact: true }).waitFor(); await close(); await start();
    await page.getByRole('heading', { name: 'Second removal note', exact: true }).waitFor(); assert.equal(await stored('cadence-text:' + id), undefined);
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-font-theme')), 'sans'); assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible()); assert.deepEqual(errors, []);
  });
  await writeFile(path.join(output, staged ? 'staged-results.json' : 'source-results.json'), JSON.stringify({ checks, errors, staged, profile: env.CADENCE_DATA_DIR }, null, 2));
} catch (error) { console.error(error.stack); if (page) { console.log(JSON.stringify(await page.evaluate(() => ({ scroll: window.__uiScroll?.slice(-18), location: document.querySelector('.viewing-location')?.dataset.location, passages: [...document.querySelectorAll('[data-location-key="page-4"] .passage')].slice(0, 2).map(element => { const b = element.getBoundingClientRect(); const word = element.querySelector('.read-word'), w = word?.getBoundingClientRect(); return { index: element.dataset.passageIndex, top: b.top, bottom: b.bottom, wordTop: w?.top, hit: w ? document.elementFromPoint(w.x + w.width / 2, w.y + w.height / 2)?.outerHTML.slice(0, 200) : '' }; }) })), null, 2)); await page.screenshot({ path: path.join(output, 'failure.png') }); } throw error; }
finally { await close(); }
