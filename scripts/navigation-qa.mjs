import { menuClick } from './reader-qa-helpers.mjs';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fivePagePdf } from './pdf-fixture.mjs';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = process.argv.includes('--staged');
await mkdir('test-results/fixtures', { recursive: true });
await writeFile('test-results/fixtures/Navigation.pdf', fivePagePdf({ blankPage: 3, labels: true }));
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/navigation-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: [...(staged ? [] : ['.']), '--force-device-scale-factor=1'], env, timeout: 60000 });
const page = await app.firstWindow();
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
const input = () => page.getByLabel('Go to original page', { exact: true });
async function jump(number) { await input().fill(String(number)); await input().press('Enter'); await page.waitForFunction(number => document.querySelector('.viewing-location')?.getAttribute('data-location') === `page-${number}`, number); }
async function showNavigation() { if (await page.getByLabel('Document navigation', { exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByLabel('Document navigation', { exact: true }).click(); }
try {
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async () => ({ samples: Float32Array.from({ length: 120000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }));
  });
  await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Navigation.pdf');
  await page.getByRole('heading', { name: 'Navigation', exact: true }).waitFor();
  await check('Reading view preserves all original pages and embedded page labels', async () => {
    assert.equal(await page.locator('.reading-page-section').count(), 5);
    assert.ok(await page.locator('.passage').count() > 0 && await page.locator('.passage').count() <= 32);
    await page.locator('.original-page-marker').filter({ hasText: 'Page i · PDF 1' }).waitFor();
    await showNavigation();
    assert.equal(await page.locator('.navigation-entry').count(), 5);
    assert.equal(await input().inputValue(), '1');
  });
  await check('Page sidebar changes browsing without disturbing narration', async () => {
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByLabel('Browse page 4', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4');
    assert.equal(await page.getByLabel('Browse page 4', { exact: true }).getAttribute('aria-current'), 'location');
    await page.getByText('Audio on page 1', { exact: true }).waitFor();
    const before = Number(await page.getByLabel('Reading progress', { exact: true }).inputValue());
    await page.waitForTimeout(1200);
    assert.ok(Number(await page.getByLabel('Reading progress', { exact: true }).inputValue()) > before);
    assert.equal(await input().inputValue(), '4');
    await page.getByLabel('Pause narration', { exact: true }).click();
  });
  await check('Manual scrolling updates the page number and sidebar highlight', async () => {
    await page.locator('[data-location-key="page-5"]').evaluate(element => { const scroll = element.closest('.reader-scroll'); scroll.scrollTo({ top: scroll.scrollTop + element.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 8, behavior: 'instant' }); });
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-5');
    assert.equal(await input().inputValue(), '5');
    assert.equal(await page.getByLabel('Browse page 5', { exact: true }).getAttribute('aria-current'), 'location');
    await page.getByText('Audio on page 1', { exact: true }).waitFor();
  });
  await check('Jump box and previous/next controls navigate physical PDF pages', async () => {
    await jump(2);
    await page.getByLabel('Next document page', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-3');
    await page.getByLabel('Previous document page', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-2');
    await jump(1); assert.ok(await page.getByLabel('Previous document page', { exact: true }).isDisabled());
    await jump(5); assert.ok(await page.getByLabel('Next document page', { exact: true }).isDisabled());
  });
  await check('Blank pages remain navigable and can open in the original PDF', async () => {
    await jump(3);
    await page.locator('[data-location-key="page-3"] .unreadable-page').waitFor();
    await page.getByRole('button', { name: 'View original page', exact: true }).click();
    await page.getByText('Page 3 of 5', { exact: true }).waitFor();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
  });
  await check('Switching between reading and original views keeps the browsed page', async () => {
    await jump(4);
    await page.getByRole('button', { name: 'Reading view', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4');
    await page.getByRole('button', { name: 'Document view', exact: true }).click();
    await page.getByText('Page 4 of 5', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reading view', exact: true }).click();
  });
  await check('Sidebar filtering and navigation after a text search work together', async () => {
    await showNavigation();
    await page.getByLabel('Filter document navigation', { exact: true }).fill('page 5 passage');
    assert.equal(await page.locator('.navigation-entry').count(), 1);
    await page.getByLabel('Browse page 5', { exact: true }).click();
    await page.getByLabel('Filter document navigation', { exact: true }).fill('');
    await page.getByLabel('Search document', { exact: true }).click();
    await page.getByLabel('Search document text', { exact: true }).fill('page 5 passage 1');
    assert.equal(await page.locator('.reading-page-section').count(), 1);
    await jump(1);
    assert.equal(await page.getByLabel('Search document text', { exact: true }).inputValue(), '');
    assert.equal(await page.locator('.reading-page-section').count(), 5);
    await page.getByLabel('Close search', { exact: true }).click();
    await jump(4);
    await page.screenshot({ path: 'test-results/document-navigation.png' });
  });
  await check('Compact navigation overlays the reader and closes after a page jump', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
    await showNavigation();
    await page.getByLabel('Browse page 2', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-2');
    assert.equal(await page.getByLabel('Document navigation', { exact: true }).getAttribute('aria-expanded'), 'false');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: 'test-results/navigation-compact.png' });
  });
  await check('Previously imported PDFs gain page labels without reimporting', async () => {
    await page.waitForTimeout(600);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, transaction = db.transaction('keyval', 'readwrite'), store = transaction.objectStore('keyval');
        const saved = store.get('cadence-library-index-v2');
        saved.onsuccess = () => { const docs = saved.result; for (const doc of docs) delete doc.pageLabels; store.put(docs, 'cadence-library-index-v2'); };
        transaction.oncomplete = () => { db.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
    }));
    await page.reload();
    await page.getByRole('heading', { name: 'Navigation', exact: true }).waitFor();
    await jump(1); // Restart preserves the browsed page rather than returning to page one.
    await page.locator('.original-page-marker').filter({ hasText: 'Page i · PDF 1' }).waitFor();
    assert.equal(await page.locator('.reading-page-section').count(), 5);
  });
  await check('Word and text documents have section navigation without false page numbers', async () => {
    await menuClick(page.getByLabel('Paste text', { exact: true }));
    await page.getByLabel('Document title', { exact: true }).fill('Section navigation');
    await page.getByLabel('Your text', { exact: true }).fill('Introduction\n\nA good story takes you somewhere new.\n\nA different chapter\n\nThe second section is easy to find.');
    await page.getByRole('button', { name: 'Add to my library' }).click();
    await showNavigation();
    await page.getByRole('button', { name: 'Sections', exact: true }).click();
    assert.equal(await page.locator('.navigation-entry').count(), 2);
    await page.getByLabel('Browse section 2', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-2' && document.querySelector('[aria-label="Go to section"]')?.value === '2');
    assert.equal(await page.getByLabel('Go to section', { exact: true }).inputValue(), '2');
    assert.equal(await page.getByLabel('Go to original page', { exact: true }).count(), 0);
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/navigation-results.json', JSON.stringify({ checks, errors, staged }, null, 2));
} catch (error) { await page.screenshot({ path: 'test-results/navigation-failure.png' }); throw error; }
finally { await app.close(); }
