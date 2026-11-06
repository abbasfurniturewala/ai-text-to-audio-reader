import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord, menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = process.argv.includes('--staged');
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/paragraph-qa-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow(), checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const beginning = "Charlie's formal education began at Dundee Elementary School where he and his younger sisters, Nancy and Carol, were indoctrinated with ethical";
const ending = "homilies. Charlie's teachers remember a smart kid who enjoyed learning.";
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function stored(key) {
  return page.evaluate(key => new Promise(resolve => {
    const open = indexedDB.open('keyval-store'); open.onsuccess = () => {
      const db = open.result, tx = db.transaction('keyval'), get = tx.objectStore('keyval').get(key);
      get.onsuccess = () => resolve(get.result); tx.oncomplete = () => db.close();
    };
  }), key);
}
try {
  await app.evaluate(({ ipcMain }) => {
    globalThis.__paragraphRequests = [];
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__paragraphRequests.push(request.text);
      return { samples: Float32Array.from({ length: 72000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.waitForTimeout(600);
  await page.evaluate(({ beginning, ending }) => new Promise(resolve => {
    const open = indexedDB.open('keyval-store'); open.onsuccess = () => {
      const db = open.result, tx = db.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval');
      store.clear();
      store.put([{ id: 'legacy-paragraph', title: 'Legacy paragraphs', kind: 'PDF', pageCount: 10, pageLabels: [], topics: [], created: 1, updated: 1,
        position: 1, bookmarks: [0, 1, 2], segmentCount: 3, wordCount: 50, bookmarkPreviews: {} }], 'cadence-library-index-v2');
      store.put([{ text: beginning, page: 10 }, { text: ending, page: 10 }, { text: 'The next complete paragraph.', page: 10 }], 'cadence-text:legacy-paragraph');
      store.put(new Blob(['original file preserved']), 'cadence-file:legacy-paragraph');
      localStorage.setItem('cadence-document', 'legacy-paragraph');
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), { beginning, ending });
  await page.reload();
  await page.getByRole('heading', { name: 'Legacy paragraphs', exact: true }).waitFor();
  await check('Existing books repair split sentences, preserving saved position, bookmarks and original files', async () => {
    const [item] = await stored('cadence-library-index-v2');
    assert.equal(item.textVersion, 2); assert.equal(item.position, 0); assert.deepEqual(item.bookmarks, [0, 1]);
    assert.equal(item.segmentCount, 2); assert.equal(item.bookmarkPreviews[0].text, beginning + ' ' + ending);
    assert.equal((await stored('cadence-text:legacy-paragraph'))[0].text, beginning + ' ' + ending);
    assert.equal(await page.evaluate(async () => {
      const db = await new Promise(resolve => { const request = indexedDB.open('keyval-store'); request.onsuccess = () => resolve(request.result); });
      const file = await new Promise(resolve => { const request = db.transaction('keyval').objectStore('keyval').get('cadence-file:legacy-paragraph'); request.onsuccess = () => resolve(request.result); });
      db.close(); return file.text();
    }), 'original file preserved');
  });
  await page.getByLabel('Go to original page', { exact: true }).fill('10');
  await page.getByLabel('Go to original page', { exact: true }).press('Enter');
  await page.locator('[data-location-key="page-10"] [data-reader-text]').first().waitFor();
  await check('The screenshot sentence is sent to the voice intact, and clicking inside the repaired block is exact', async () => {
    await clickReaderWord(page.locator('[data-location-key="page-10"] .passage').first());
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok((await app.evaluate(() => globalThis.__paragraphRequests)).includes(beginning + ' homilies.'));
    await clickReaderWord(page.locator('.passage').filter({ hasText: 'ethical' }).first(), 'ethical');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok((await app.evaluate(() => globalThis.__paragraphRequests)).some(text => text.startsWith('ethical homilies.')));
    await page.getByLabel('Pause narration', { exact: true }).click();
  });
  await check('Reopening a repaired book is idempotent', async () => {
    const before = await stored('cadence-text:legacy-paragraph');
    await page.reload();
    await page.getByRole('heading', { name: 'Legacy paragraphs', exact: true }).waitFor();
    assert.deepEqual(await stored('cadence-text:legacy-paragraph'), before);
  });
  await check('Long display paragraphs remain intact and exports use complete sentence requests', async () => {
    const sentence = 'A paragraph can contain many sentences and keep its natural layout while the voice prepares complete thoughts in the background.';
    const paragraph = Array(20).fill(sentence).join(' ');
    await menuClick(page.getByLabel('Paste text', { exact: true }));
    await page.getByLabel('Document title', { exact: true }).fill('Long paragraph');
    await page.getByLabel('Your text', { exact: true }).fill(paragraph);
    await page.getByRole('button', { name: 'Add to my library' }).click();
    await page.getByRole('heading', { name: 'Long paragraph', exact: true }).waitFor();
    assert.equal(await page.locator('.passage').count(), 1);
    assert.equal((await page.locator('.passage').textContent()).trim(), paragraph);
    await app.evaluate(() => { globalThis.__paragraphRequests = []; });
    await page.locator('.voice-option').filter({ hasText: 'George' }).click();
    await page.getByRole('button', { name: 'Export audio', exact: true }).click();
    await page.getByLabel('Audio format', { exact: true }).selectOption('wav');
    await page.getByRole('button', { name: 'Create audio file', exact: true }).click();
    await page.getByRole('button', { name: 'Save WAV', exact: true }).waitFor({ timeout: 60000 });
    const requests = await app.evaluate(() => globalThis.__paragraphRequests);
    assert.ok(requests.length > 0); assert.ok(requests.every(text => text === sentence));
  });
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/paragraph-results.json', JSON.stringify({ checks, errors, staged }, null, 2));
} catch (error) { await page.screenshot({ path: 'test-results/paragraph-failure.png' }); throw error; }
finally { await app.close(); }
