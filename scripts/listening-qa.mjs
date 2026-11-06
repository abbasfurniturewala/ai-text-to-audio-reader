import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord } from './reader-qa-helpers.mjs';
import { fivePagePdf } from './pdf-fixture.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright'), JSZip = require('jszip');
const output = path.resolve('test-results/listening-improvements'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir(output, { recursive: true });
const staged = process.argv.includes('--staged');
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
let app, page;
const checks = [], errors = [];
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480, 960);
    globalThis.__listening = { requests: [], cancels: [], original: ipcMain._invokeHandlers.get('reader:synthesize') };
    const cancel = ipcMain._invokeHandlers.get('reader:cancel-speech'); ipcMain.removeHandler('reader:cancel-speech');
    ipcMain.handle('reader:cancel-speech', (...args) => { globalThis.__listening.cancels.push(args[1]); return cancel(...args); });
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__listening.requests.push(request);
      if (request.text.startsWith('Hello,')) await new Promise(resolve => setTimeout(resolve, 800));
      return { samples: Float32Array.from({ length: 120000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
}
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function stored(key) { return page.evaluate(key => new Promise(resolve => { const open = indexedDB.open('keyval-store'); open.onsuccess = () => { const db = open.result, tx = db.transaction('keyval'), request = tx.objectStore('keyval').get(key); request.onsuccess = () => resolve(request.result); tx.oncomplete = () => db.close(); }; }), key); }
async function upload(filename, title) { await page.locator('input[type=file]').setInputFiles(filename); await page.getByRole('heading', { name: title, exact: true }).waitFor(); }
async function jump(number) { await page.getByLabel('Go to original page', { exact: true }).fill(String(number)); await page.getByLabel('Go to original page', { exact: true }).press('Enter'); await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, number); }
function marginPdf() {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'], pages = [];
  for (let number = 1; number <= 3; number++) {
    const id = objects.length + 1; pages.push(`${id} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const lines = number === 1 ? ['This sentence continues with many carefully chosen words so the reader can', 'follow the complete explanation across a physical page boundary and'] : ['finishes on the next page without repeating the running header.'];
    const stream = 'BT /F1 10 Tf 72 770 Td (BOOK TITLE) Tj 0 -70 Td ' + lines.map((line, i) => `${i ? '0 -18 Td ' : ''}(${line}) Tj`).join(' ') + ` ET BT /F1 10 Tf 300 25 Td (${number}) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'; objects[1] = `<< /Type /Pages /Kids [${pages.join(' ')}] /Count 3 >>`;
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  return body + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(body)}\n%%EOF`;
}
const epub = new JSZip();
epub.file('mimetype', 'application/epub+zip');
epub.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
epub.file('OPS/book.opf', '<package><metadata><title>Reader improvements EPUB</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
epub.file('OPS/one.xhtml', '<html><body><h1 id="one">First chapter</h1><p>A complete first paragraph.</p><h2 id="detail">A detail</h2><blockquote><p>A quotation occurs only once.</p></blockquote></body></html>');
epub.file('OPS/two.xhtml', '<html><body><h1 id="two">Second chapter</h1><p>Why did you leave?</p><p>A final paragraph remains readable.</p></body></html>');
epub.file('OPS/nav.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml#one">First chapter</a><ol><li><a href="one.xhtml#detail">A detail</a></li></ol></li><li><a href="two.xhtml#two">Second chapter</a></li></ol></nav></body></html>');
await writeFile(path.join(output, 'Sample.epub'), await epub.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
await writeFile(path.join(output, 'Margins.pdf'), marginPdf());
await writeFile(path.join(output, 'Labels.pdf'), fivePagePdf({ labels: true }));
try {
  await start(); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await check('All voices includes 23, curated keeps eight, and stopped extended-voice previews cancel', async () => {
    assert.equal(await page.locator('.voice-option').count(), 23);
    await page.getByLabel('Filter voices').selectOption('Curated voices'); assert.equal(await page.locator('.voice-option').count(), 8);
    await page.getByLabel('Filter voices').selectOption('British'); assert.equal(await page.locator('.voice-option').count(), 8);
    await page.getByLabel('Filter voices').selectOption('All voices'); assert.equal(await page.locator('.voice-option').count(), 23);
    await page.locator('.voice-option').filter({ hasText: 'Kore' }).click();
    await page.getByRole('button', { name: 'Listen to a preview', exact: true }).click();
    await page.waitForTimeout(80); await page.getByRole('button', { name: 'Stop preview', exact: true }).click();
    const preview = await app.evaluate(() => { const request = globalThis.__listening.requests.find(item => item.text.startsWith('Hello,')); return { voice: request.voice, canceled: globalThis.__listening.cancels.includes(request.requestId) }; });
    assert.deepEqual(preview, { voice: 'af_kore', canceled: true });
  });
  await check('EPUB imports compressed chapters in order with nested contents and paragraph semantics', async () => {
    await upload(path.join(output, 'Sample.epub'), 'Reader improvements EPUB');
    const item = (await stored('cadence-library-index-v2')).find(item => item.kind === 'EPUB');
    const segments = await stored('cadence-text:' + item.id);
    assert.equal(segments.filter(segment => segment.text === 'A quotation occurs only once.').length, 1);
    assert.equal(segments.find(segment => segment.text === 'Why did you leave?').heading, false);
    assert.equal(item.topics[0].children[0].title, 'A detail');
    assert.equal(await page.getByRole('button', { name: 'Document view', exact: true }).count(), 1);
    await page.reload(); await page.getByRole('heading', { name: 'Reader improvements EPUB', exact: true }).waitFor();
    await page.locator('.passage').filter({ hasText: 'Why did you leave?' }).waitFor();
    assert.equal(await page.locator('.passage').filter({ hasText: 'Why did you leave?' }).evaluate(element => element.classList.contains('passage-heading')), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-local-voice')), 'af_kore');
  });
  await check('Blends can be selected and the two-step WAV export saves valid PCM', async () => {
    await page.locator('.voice-blender summary').click();
    await page.getByLabel('First blend voice').selectOption('af_heart'); await page.getByLabel('Second blend voice').selectOption('bf_emma');
    await page.getByRole('button', { name: 'Use blend', exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-local-voice')), 'blend_af_heart_bf_emma_65');
    await page.mouse.move(30, 30); await page.getByRole('button', { name: 'Export audio', exact: true }).click();
    await page.getByLabel('Audio format', { exact: true }).selectOption('wav');
    await page.getByRole('button', { name: 'Create audio file', exact: true }).click();
    await page.getByRole('button', { name: 'Save WAV', exact: true }).waitFor();
    const filename = path.join(output, staged ? 'staged-export.wav' : 'source-export.wav');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, filename);
    await page.getByRole('button', { name: 'Save WAV', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Your audio has been saved' }).waitFor();
    const bytes = await readFile(filename); assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt16LE(34), 16); assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
    await page.getByLabel('Close dialog', { exact: true }).click();
  });
  await check('PDF import removes repeated margin text and preserves exact body word clicks', async () => {
    await upload(path.join(output, 'Margins.pdf'), 'Margins');
    const item = (await stored('cadence-library-index-v2')).find(item => item.title === 'Margins'), segments = await stored('cadence-text:' + item.id);
    assert.ok(!segments.some(segment => segment.text.includes('BOOK TITLE') || /^\d+$/.test(segment.text)));
    await clickReaderWord(page.locator('.passage').filter({ hasText: 'carefully' }).first(), 'carefully'); await page.getByLabel('Pause narration', { exact: true }).waitFor(); await page.getByLabel('Pause narration', { exact: true }).click();
    assert.ok((await app.evaluate(() => globalThis.__listening.requests)).some(request => request.text.startsWith('carefully chosen words')));
    await page.getByRole('button', { name: 'Document view', exact: true }).click(); await jump(1); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await page.locator('.pdf-text-layer span').filter({ hasText: /carefully/ }).first().click(); await page.getByLabel('Pause narration', { exact: true }).waitFor(); await page.getByLabel('Pause narration', { exact: true }).click();
  });
  await check('Current navigation metadata recovers missing page labels without resetting the browsed page', async () => {
    await upload(path.join(output, 'Labels.pdf'), 'Labels'); await jump(2); await page.waitForTimeout(650);
    await page.evaluate(() => new Promise(resolve => { const open = indexedDB.open('keyval-store'); open.onsuccess = () => { const db = open.result, tx = db.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval'), request = store.get('cadence-library-index-v2'); request.onsuccess = () => store.put(request.result.map(item => { if (item.title === 'Labels') delete item.pageLabels; return item; }), 'cadence-library-index-v2'); tx.oncomplete = () => { db.close(); resolve(); }; }; }));
    await page.reload(); await page.getByRole('heading', { name: 'Labels', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-2');
    await page.locator('.original-page-marker').filter({ hasText: 'Page ii · PDF 2' }).waitFor();
  });
  await check('Real offline extended and blended voices generate non-silent audio from the desktop bridge', async () => {
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', globalThis.__listening.original); });
    for (const voice of ['af_kore', 'blend_af_heart_bf_emma_65', 'blend_af_heart_bf_emma_0', 'blend_af_heart_bf_emma_100']) {
      const result = await page.evaluate(async voice => { const audio = await window.cadence.synthesize({ text: 'A complete sentence, with natural breathing room.', voice }); return { length: audio.samples.length, rate: audio.sampleRate, peak: Math.max(...audio.samples.subarray(0, 100000).map(Math.abs)) }; }, voice);
      assert.equal(result.rate, 24000); assert.ok(result.length > 24000); assert.ok(result.peak > .01);
    }
  });
  await check('Blended selection and EPUB library contents survive a complete app restart with audio paused', async () => {
    const closing = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closing; app = undefined;
    await start(); await page.getByRole('heading', { name: 'Labels', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-local-voice')), 'blend_af_heart_bf_emma_65');
    assert.equal(await page.locator('.voice-option').count(), 23);
    assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
    assert.ok((await stored('cadence-library-index-v2')).some(item => item.kind === 'EPUB'));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, staged ? 'staged-reader.png' : 'source-reader.png') });
  });
  await writeFile(path.join(output, staged ? 'staged-results.json' : 'source-results.json'), JSON.stringify({ checks, errors, staged, profile: env.CADENCE_DATA_DIR }, null, 2));
} catch (error) { if (page) await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
finally { if (app) await app.close(); }
