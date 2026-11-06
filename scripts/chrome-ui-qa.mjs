import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fivePagePdf } from './pdf-fixture.mjs';
import { openMenu, menuClick, waitReaderWordVisible } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const staged = process.argv.includes('--staged'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = path.resolve('test-results/chrome-ui'); await mkdir(output, { recursive: true });
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
let app, page; const checks = [], errors = [];
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1280, 900); win.webContents.setAudioMuted(true); globalThis.__chromeRequests = [];
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async (_, request) => { globalThis.__chromeRequests.push(request); return { samples: new Float32Array(384000).fill(.1), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }; });
  });
}
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
async function jump(pageNumber) { const input = page.getByLabel('Go to original page', { exact: true }); await input.fill(String(pageNumber)); await input.press('Enter'); await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, pageNumber); }
try {
  await start(); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await check('Menu starts closed, overlays without resizing the reader, traps focus and dismisses with Escape', async () => {
    assert.equal(await page.locator('.library-menu').isVisible(), false);
    const before = await page.locator('.reader-scroll').boundingBox(); await openMenu(page);
    const after = await page.locator('.reader-scroll').boundingBox(); assert(Math.abs(before.width - after.width) < 1); assert(Math.abs(before.x - after.x) < 1);
    assert.equal(await page.getByRole('button', { name: 'Import document', exact: true }).isVisible(), true);
    for (let index = 0; index < 12; index++) await page.keyboard.press('Tab');
    assert(await page.evaluate(() => document.querySelector('.library-menu').contains(document.activeElement)));
    await page.keyboard.press('Escape'); await page.locator('.library-menu').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Menu', exact: true }).getAttribute('aria-expanded'), 'false');
  });
  await check('Empty Bookmarks has a clear return to the reader', async () => {
    await menuClick(page.getByRole('button', { name: /^Bookmarks/ })); await page.getByRole('heading', { name: 'Your bookmarks', exact: true }).waitFor();
    assert.equal(await page.locator('.library-menu').isVisible(), false);
    await page.getByRole('button', { name: 'Back to reading', exact: true }).click(); await page.locator('.reader-scroll').waitFor();
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'Chrome navigation.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fivePagePdf({ blankPage: 4 })) });
  await page.getByRole('heading', { name: 'Chrome navigation', exact: true }).waitFor();
  await page.getByLabel('Play narration', { exact: true }).click(); await page.getByLabel('Pause narration', { exact: true }).waitFor(); await jump(3);
  await page.getByLabel('Bookmark viewed passage', { exact: true }).click();
  await check('Populated Bookmarks returns to the browsed page without restarting independent audio', async () => {
    const target = page.locator('[data-location-key="page-3"] .passage').nth(4), index = Number(await target.getAttribute('data-passage-index'));
    await target.evaluate(element => { const root = element.closest('.reader-scroll'), marker = element.closest('section').querySelector('.original-page-marker'), inset = marker.getBoundingClientRect().height + parseFloat(getComputedStyle(root).paddingTop) + parseFloat(getComputedStyle(marker).top) + 16; root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - inset, behavior: 'instant' }); });
    await page.waitForFunction(index => { const saved = JSON.parse(localStorage.getItem('cadence-reader-session-v1')); return saved?.books[saved.lastId]?.segment === index; }, index);
    const requests = await app.evaluate(() => globalThis.__chromeRequests.filter(request => request.priority === 'interactive').length);
    await menuClick(page.getByRole('button', { name: /^Bookmarks/ })); assert.equal(await page.locator('.bookmark-card').count(), 1);
    await page.getByRole('button', { name: 'Back to reading', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-3');
    await waitReaderWordVisible(target, 4, 28);
    assert.equal(await page.getByLabel('Pause narration', { exact: true }).isVisible(), true);
    assert.equal(await app.evaluate(() => globalThis.__chromeRequests.filter(request => request.priority === 'interactive').length), requests);
  });
  await check('Manual Hide survives mouse movement, scrolling and the idle deadline while audio continues', async () => {
    await page.getByLabel('Hide playback controls', { exact: true }).click(); await page.locator('.player').waitFor({ state: 'hidden' });
    await page.mouse.move(700, 300); await page.mouse.wheel(0, 300); await page.waitForTimeout(11000); await page.mouse.move(720, 340);
    assert.equal(await page.locator('.player').isVisible(), false); assert.equal(await page.locator('.player-dock').getAttribute('data-manual-hidden'), 'true');
    assert.equal(await page.locator('.player .play-button').getAttribute('aria-label'), 'Pause narration');
    await page.screenshot({ path: path.join(output, staged ? 'staged-hidden.png' : 'source-hidden.png') });
  });
  await check('Explicit Show and an ordinary menu click each restore a manually hidden player', async () => {
    await page.getByLabel('Show playback controls', { exact: true }).click(); await page.locator('.player').waitFor();
    await page.getByLabel('Hide playback controls', { exact: true }).click(); await page.locator('.player').waitFor({ state: 'hidden' });
    await openMenu(page); assert.equal(await page.locator('.player').getAttribute('aria-hidden'), 'false'); await page.keyboard.press('Escape');
    await page.getByLabel('Pause narration', { exact: true }).click();
  });
  await check('Keyboard Hide and Show remain usable without restarting narration', async () => {
    await page.getByLabel('Hide playback controls', { exact: true }).press('Enter'); await page.locator('.player').waitFor({ state: 'hidden' });
    await page.mouse.move(900, 400); assert.equal(await page.locator('.player').isVisible(), false);
    await page.getByLabel('Show playback controls', { exact: true }).press('Enter'); await page.locator('.player').waitFor();
    await page.getByText('TAKE YOUR TIME', { exact: true }).waitFor();
  });
  await check('Full-screen manual Hide also ignores scrolling and restores through its explicit handle', async () => {
    await page.getByLabel('Enter full screen', { exact: true }).click(); await page.locator('.app-shell.focus-mode').waitFor(); await page.waitForTimeout(350);
    await page.getByLabel('Hide playback controls', { exact: true }).click(); await page.locator('.player').waitFor({ state: 'hidden' });
    await page.mouse.move(650, 250); await page.mouse.wheel(0, 150); assert.equal(await page.locator('.player').isVisible(), false);
    await page.getByLabel('Show playback controls', { exact: true }).click(); await page.locator('.player').waitFor();
    await page.keyboard.press('Escape'); await page.locator('.app-shell:not(.focus-mode)').waitFor(); await page.waitForTimeout(350);
  });
  await check('Original PDF mode, zoom and a blank browsing page survive a Bookmarks round trip', async () => {
    await page.getByRole('button', { name: 'Document view', exact: true }).click(); await jump(4); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await page.getByLabel('PDF zoom', { exact: true }).selectOption('1.25'); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await menuClick(page.getByRole('button', { name: /^Bookmarks/ })); await page.getByRole('button', { name: 'Back to reading', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4'); await page.locator('[data-pdf-page="4"] canvas').waitFor();
    assert.equal(await page.getByLabel('PDF zoom', { exact: true }).inputValue(), '1.25'); assert.equal(await page.getByLabel('Play narration', { exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Reading view', exact: true }).click(); await page.getByText('This page has no selectable text.', { exact: true }).waitFor();
    await menuClick(page.getByRole('button', { name: /^Bookmarks/ })); await page.getByRole('button', { name: 'Back to reading', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4'); await page.getByText('This page has no selectable text.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Document view', exact: true }).click(); await page.locator('[data-pdf-page="4"] canvas').waitFor();
  });
  await check('Bookmarks opened from the library returns to the library', async () => {
    await menuClick(page.getByRole('button', { name: /^My library/ })); await menuClick(page.getByRole('button', { name: /^Bookmarks/ }));
    await page.getByRole('button', { name: 'Back to library', exact: true }).click(); await page.getByRole('heading', { name: 'Your words. Your rhythm.', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to reading', exact: true }).click(); await page.locator('.pdf-document').waitFor();
  });
  await check('Compact menu keeps labeled actions reachable and closes from its backdrop', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700)); await openMenu(page);
    for (const name of ['Import document', 'Settings', 'Close menu']) { const button = page.getByRole('button', { name, exact: true }); await button.scrollIntoViewIfNeeded(); const box = await button.boundingBox(); assert(box.y >= 0 && box.y + box.height <= 700, JSON.stringify({ name, box })); }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
    for (const name of ['Import document', 'Settings']) assert((await page.getByRole('button', { name, exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize))) >= 11);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.screenshot({ path: path.join(output, staged ? 'staged-menu.png' : 'source-menu.png') });
    await page.mouse.click(650, 200); await page.locator('.library-menu').waitFor({ state: 'hidden' });
  });
  await check('Restart restores the document paused with the Menu closed', async () => {
    await openMenu(page); await app.close(); await start(); await page.getByRole('heading', { name: 'Chrome navigation', exact: true }).waitFor();
    assert.equal(await page.locator('.library-menu').isVisible(), false); await page.getByLabel('Play narration', { exact: true }).waitFor(); assert.deepEqual(errors, []);
  });
  await writeFile(path.join(output, staged ? 'staged.json' : 'source.json'), JSON.stringify({ checks, errors, profile: env.CADENCE_DATA_DIR }, null, 2));
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
finally { await app?.close(); }
