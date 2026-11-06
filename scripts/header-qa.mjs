import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fivePagePdf } from './pdf-fixture.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const baseline = process.argv.includes('--baseline'), staged = process.argv.includes('--staged');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const executable = baseline ? path.resolve('release/win-unpacked/Cadence.exe') : staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron');
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/header-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: executable, args: baseline || staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow(), checks = [], errors = [];
const title = 'Poor Charlie’s Almanack The Wit and Wisdom of Charles T. Munger ( PDFDrive )';
const before = await readFile('test-results/header-baseline.json', 'utf8').then(JSON.parse).catch(() => undefined);
page.on('pageerror', error => errors.push(error.message));
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
const measure = () => page.evaluate(() => {
  const reader = document.querySelector('.reader-scroll').getBoundingClientRect();
  const workspace = document.querySelector('.workspace').getBoundingClientRect();
  return { headerHeight: Math.round(reader.top - workspace.top), readerHeight: Math.round(reader.height), width: innerWidth };
});
try {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 900);
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async () => ({ samples: new Float32Array(24000), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }));
  });
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.locator('input[type=file]').setInputFiles({ name: title + '.pdf', mimeType: 'application/pdf', buffer: Buffer.from(fivePagePdf()) });
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  const initial = await measure();
  await mkdir('test-results', { recursive: true });
  if (baseline) {
    await writeFile('test-results/header-baseline.json', JSON.stringify(initial, null, 2));
    console.log(JSON.stringify(initial));
  } else {
    await check('Long titles use one compact line with full title and document metadata available', async () => {
      const heading = page.locator('.reader-document-heading h1');
      assert.equal(await heading.getAttribute('title'), title);
      assert.ok((await heading.boundingBox()).height <= 24);
      assert.equal(await page.locator('.reader-document-heading .document-meta').isVisible(), true);
      assert.ok((await page.locator('.reader-document-heading .document-meta').textContent()).includes('5 pages'));
      assert.ok(initial.headerHeight <= 160, JSON.stringify(initial));
      if (before?.headerHeight > 160) assert.ok(initial.headerHeight < before.headerHeight * .6, `Header ${before.headerHeight}px -> ${initial.headerHeight}px`);
    });
    await page.screenshot({ path: 'test-results/header-compact-1280.png' });
    await check('Search, type controls, bookmarks and page navigation remain accessible', async () => {
      for (const name of ['Close document', 'Remove current document', 'Search document', 'Change typeface', 'Smaller text', 'Larger text', 'Bookmark viewed passage', 'Document navigation']) assert.equal(await page.getByRole('button', { name, exact: true }).isVisible(), true, name);
      await page.getByRole('button', { name: 'Search document', exact: true }).click();
      await page.getByLabel('Search document text', { exact: true }).fill('calm story');
      assert.ok(await page.locator('.passage').count() > 0);
      await page.getByLabel('Close search', { exact: true }).click();
      await page.getByRole('button', { name: 'Larger text', exact: true }).click();
      await page.getByRole('button', { name: 'Change typeface', exact: true }).click();
      assert.equal(await page.locator('.reading-paper.sans').count(), 1);
      await page.getByLabel('Go to original page', { exact: true }).fill('4');
      await page.getByLabel('Go to original page', { exact: true }).press('Enter');
      await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4');
      await page.getByRole('button', { name: 'Bookmark viewed passage', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Remove bookmark', exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'Go to audio', exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).isVisible(), true);
    });
    await check('Original PDF shares the compact controls', async () => {
      await page.getByRole('button', { name: 'Document view', exact: true }).click();
      await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.pdf-page-slot[data-current="true"] canvas').isVisible(), true);
      assert.equal((await measure()).headerHeight, initial.headerHeight);
    });
    await check('Controls wrap without overlap at 1024px', async () => {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
      await page.waitForFunction(() => innerWidth === 1024);
      assert.ok((await measure()).headerHeight <= 185, JSON.stringify(await measure()));
      const bounds = await page.locator('.topbar button, .reading-toolbar button, .reader-navigation-bar button, .reader-navigation-bar input').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => { const rect = element.getBoundingClientRect(); return { name: element.getAttribute('aria-label') || element.textContent, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }; }));
      assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= 1024), JSON.stringify(bounds));
      for (let first = 0; first < bounds.length; first++) for (let second = first + 1; second < bounds.length; second++) {
        const a = bounds[first], b = bounds[second];
        assert.ok(Math.min(a.right, b.right) - Math.max(a.left, b.left) < 1 || Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 1, `Controls overlap: ${a.name} / ${b.name}`);
      }
      await page.screenshot({ path: 'test-results/header-compact-1024.png' });
    });
    await check('Full screen removes the entire header with no empty toolbar gap', async () => {
      await page.getByRole('button', { name: 'Enter full screen', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.app-shell').classList.contains('focus-mode'));
      assert.equal(await page.locator('.reader-navigation-bar').isVisible(), false);
      assert.ok((await measure()).headerHeight <= 1);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.app-shell').classList.contains('focus-mode'));
    });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ before, after: initial }));
    await writeFile('test-results/header-results.json', JSON.stringify({ checks, errors, before, after: initial, staged }, null, 2));
  }
} catch (error) { await page.screenshot({ path: 'test-results/header-failure.png' }); throw error; }
finally { await app.close(); }
