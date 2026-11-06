import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fivePagePdf } from './pdf-fixture.mjs';
import { clickReaderWord, readerSpeechText, menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const staged = process.argv.includes('--staged');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir('test-results/fixtures', { recursive: true });
await writeFile('test-results/fixtures/Memory pages.pdf', fivePagePdf());
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/memory-qa-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: [...(staged ? [] : ['.']), '--force-device-scale-factor=1'], env, timeout: 60000 });
const page = await app.firstWindow();
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function stored(key) {
  return page.evaluate(key => new Promise((resolve, reject) => {
    const request = indexedDB.open('keyval-store');
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('keyval'), get = tx.objectStore('keyval').get(key);
      get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); tx.oncomplete = () => db.close();
    };
  }), key);
}
async function jump(number) {
  await page.getByLabel('Go to original page', { exact: true }).fill(String(number));
  await page.getByLabel('Go to original page', { exact: true }).press('Enter');
  await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, number);
  await page.locator(`[data-location-key="page-${number}"] [data-reader-text]`).first().waitFor();
}
async function boundedText() {
  const count = await page.locator('[data-reader-text]').count();
  assert(count > 0 && count < 100, `Mounted ${count} native text runs`);
  assert.equal(await page.locator('.read-word').count(), 0);
  const decorations = await page.locator('.passage *').count(); assert(decorations < 300, `Mounted ${decorations} passage decorations`);
}
try {
  await app.evaluate(({ ipcMain }) => {
    globalThis.__memoryRequests = [];
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__memoryRequests.push(request);
      return { samples: Float32Array.from({ length: 72000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.waitForTimeout(600);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('keyval-store');
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval');
      const docs = Array.from({ length: 3 }, (_, book) => ({ id: `memory-book-${book}`, title: `Memory book ${book + 1}`, kind: 'PDF', created: book + 1, updated: 123,
        segments: Array.from({ length: 806 }, (_, p) => Array.from({ length: 6 }, (_, n) => ({ page: p + 1, text: `Page ${p + 1} passage ${n + 1}. ` + 'A thoughtful reader explores the words and follows the story across the page. '.repeat(5) }))).flat(),
        pageCount: 806, position: 0, bookmarks: [7], pageLabels: [], topics: [], navigationVersion: 3, navigationSource: 'none', bytes: new ArrayBuffer(12 * 1024 * 1024) }));
      store.clear(); store.put(docs, 'cadence-library-v1');
      localStorage.setItem('cadence-document', docs[0].id);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await page.getByRole('heading', { name: 'Memory book 1', exact: true }).waitFor();
  await check('Old libraries migrate atomically, preserving text, files, bookmarks and positions', async () => {
    const index = await stored('cadence-library-index-v2');
    assert.equal(index.length, 3); assert.equal(index[0].position, 0);
    assert.deepEqual(index[0].bookmarks, [7]); assert.ok(index[0].bookmarkPreviews[7].text.startsWith('Page 2 passage 2.'));
    assert.ok(index.every(item => !('bytes' in item) && !('segments' in item)));
    assert.equal(await stored('cadence-library-v1'), undefined);
    const records = await page.evaluate(() => new Promise(resolve => {
      const open = indexedDB.open('keyval-store'); open.onsuccess = () => {
        const db = open.result, tx = db.transaction('keyval'), store = tx.objectStore('keyval'), lengths = [];
        for (let i = 0; i < 3; i++) {
          const file = store.get(`cadence-file:memory-book-${i}`); file.onsuccess = () => lengths.push(file.result.size);
          const text = store.get(`cadence-text:memory-book-${i}`); text.onsuccess = () => lengths.push(text.result.length);
        }
        tx.oncomplete = () => { db.close(); resolve(lengths); };
      };
    }));
    assert.deepEqual(records, [12582912, 4836, 12582912, 4836, 12582912, 4836]);
  });
  await check('An 806-page book mounts bounded native text and can jump far ahead', async () => {
    assert.equal(await page.locator('.reading-page-section').count(), 806);
    await boundedText();
    await jump(500);
    await page.waitForTimeout(400);
    assert.ok(await page.locator('[data-location-key="page-500"] .passage').first().isVisible());
    await boundedText();
    await jump(700); await jump(27); await jump(500);
    await boundedText();
  });
  await check('Word playback on a distant virtual page is exact and saves only small metadata', async () => {
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      window.__savedKeys = [];
      IDBObjectStore.prototype.put = function(value, key) { window.__savedKeys.push(key); return put.call(this, value, key); };
    });
    await clickReaderWord(page.locator('[data-location-key="page-500"] .passage').filter({ hasText: 'thoughtful' }).first(), 'thoughtful');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByText('Audio on page 500', { exact: true }).waitFor();
    await page.waitForTimeout(650);
    assert.ok((await app.evaluate(() => globalThis.__memoryRequests)).some(request => request.text.startsWith('thoughtful reader')));
    const keys = await page.evaluate(() => window.__savedKeys);
    assert.ok(keys.includes('cadence-library-index-v2')); assert.ok(keys.every(key => key === 'cadence-library-index-v2'));
    await jump(600);
    await page.waitForTimeout(700);
    assert.equal(await page.getByLabel('Go to original page', { exact: true }).inputValue(), '600');
    await page.getByRole('button', { name: 'Go to audio', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-500');
    await page.getByLabel('Pause narration', { exact: true }).click();
  });
  await check('Search still finds content on unloaded pages and clears back to navigation', async () => {
    await page.getByLabel('Search document', { exact: true }).click();
    await page.getByLabel('Search document text', { exact: true }).fill('Page 750 passage 3.');
    await page.waitForFunction(() => document.querySelectorAll('.reading-page-section').length === 1);
    await page.locator('.passage').filter({ hasText: 'Page 750 passage 3.' }).waitFor();
    await page.getByLabel('Close search', { exact: true }).click();
    await jump(750);
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Close menu', exact: true }).click();
    assert.equal(await page.getByLabel('Go to original page', { exact: true }).inputValue(), '750');
  });
  await check('Switching documents reads only the selected text, never other PDF files', async () => {
    await page.evaluate(() => {
      const get = IDBObjectStore.prototype.get; window.__readKeys = [];
      IDBObjectStore.prototype.get = function(key) { window.__readKeys.push(key); return get.call(this, key); };
    });
    await menuClick(page.locator('.recent-document').filter({ hasText: 'Memory book 2' }));
    await page.getByRole('heading', { name: 'Memory book 2', exact: true }).waitFor();
    await menuClick(page.locator('.recent-document').filter({ hasText: 'Memory book 3' }));
    await page.getByRole('heading', { name: 'Memory book 3', exact: true }).waitFor();
    const keys = await page.evaluate(() => window.__readKeys);
    assert.deepEqual(keys.filter(key => key.startsWith('cadence-text:')), ['cadence-text:memory-book-1', 'cadence-text:memory-book-2']);
    assert.equal(keys.filter(key => key.startsWith('cadence-file:')).length, 0);
    await boundedText();
  });
  await check('Close stops narration and releases the reader while retaining the shelf item', async () => {
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByLabel('Close document', { exact: true }).click();
    await page.getByRole('heading', { name: 'Your words. Your rhythm.', exact: true }).waitFor();
    assert.equal(await page.locator('[data-reader-text]').count(), 0); assert.deepEqual(await readerSpeechText(page), []);
    assert.ok(await page.getByLabel('Play narration', { exact: true }).isDisabled());
    assert.equal((await stored('cadence-library-index-v2')).length, 3);
    await page.waitForTimeout(600); await page.reload();
    await page.getByRole('heading', { name: 'Your words. Your rhythm.', exact: true }).waitFor();
    assert.equal(await page.locator('[data-reader-text]').count(), 0); assert.deepEqual(await readerSpeechText(page), []);
  });
  await check('Remove works from the shelf and reader, deletes disk records, and stays removed after reload', async () => {
    await menuClick(page.getByLabel('Remove Memory book 2 from shelf', { exact: true }));
    await page.getByLabel('Dismiss removal notification', { exact: true }).click();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('.recent-document')).some(element => element.textContent.includes('Memory book 2')));
    assert.equal(await stored('cadence-file:memory-book-1'), undefined);
    assert.equal(await stored('cadence-text:memory-book-1'), undefined);
    await menuClick(page.locator('.recent-document').filter({ hasText: 'Memory book 3' }));
    await page.getByRole('heading', { name: 'Memory book 3', exact: true }).waitFor();
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByLabel('Remove current document', { exact: true }).click();
    await page.getByLabel('Dismiss removal notification', { exact: true }).click();
    await page.getByRole('heading', { name: 'Your words. Your rhythm.', exact: true }).waitFor();
    assert.equal(await stored('cadence-file:memory-book-2'), undefined);
    assert.equal(await stored('cadence-text:memory-book-2'), undefined);
    await page.waitForTimeout(600); await page.reload();
    await page.getByRole('heading', { name: 'Your words. Your rhythm.', exact: true }).waitFor();
    assert.equal((await stored('cadence-library-index-v2')).length, 1);
    await menuClick(page.getByLabel('Remove Memory book 1 from shelf', { exact: true }));
    await page.getByLabel('Dismiss removal notification', { exact: true }).click();
    await page.waitForTimeout(600); await page.reload();
    await page.getByText('Your listening library starts here.', { exact: true }).waitFor();
    assert.deepEqual(await stored('cadence-library-index-v2'), []);
  });
  await check('Cancelling import leaves no partial document and the library remains usable', async () => {
    // Delay file reading to make cancellation deterministic, independently of CPU speed.
    await page.evaluate(() => {
      const read = Blob.prototype.arrayBuffer;
      Blob.prototype.arrayBuffer = async function() { if (this instanceof File) await new Promise(resolve => setTimeout(resolve, 800)); return read.call(this); };
    });
    await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Memory pages.pdf');
    await page.getByRole('button', { name: 'Cancel import', exact: true }).click();
    await page.locator('.import-status').waitFor({ state: 'hidden' });
    assert.deepEqual(await stored('cadence-library-index-v2'), []);
    await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Memory pages.pdf');
    await page.getByRole('heading', { name: 'Memory pages', exact: true }).waitFor();
  });
  await check('Original PDF reuses one worker across page turns and releases it on close', async () => {
    const created = [];
    page.on('worker', worker => created.push(worker));
    await page.getByRole('button', { name: 'Document view', exact: true }).click();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    const count = created.length;
    assert.ok(count >= 1);
    for (let i = 0; i < 4; i++) {
      await page.getByLabel('Next PDF page', { exact: true }).click();
      await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
      assert.ok(await page.locator('.pdf-page-slot[data-current="true"] canvas').evaluate(canvas => canvas.width > 600));
    }
    assert.equal(created.length, count);
    await page.screenshot({ path: 'test-results/memory-controls.png' });
    await page.getByLabel('Close document', { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.pdf-page') === null);
    await page.waitForTimeout(300);
    assert.equal(page.workers().length, 0);
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/memory-qa-results.json', JSON.stringify({ checks, errors, staged }, null, 2));
} catch (error) { await page.screenshot({ path: 'test-results/memory-qa-failure.png' }); throw error; }
finally { await app.close(); }
