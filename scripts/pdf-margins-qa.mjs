import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const staged = process.argv.includes('--staged'), fixtureAt = process.argv.indexOf('--fixture'), fixture = fixtureAt >= 0 ? process.argv[fixtureAt + 1] : undefined;
const output = path.resolve('test-results/pdf-margins'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir(output, { recursive: true });
const before = 'Her expression, familiar to everyone who had spent a long and interesting afternoon in that quiet room, showed a continual consciousness of her charming defect, which', after = 'she neither wished nor could conceal.';
const bodies = ['The opening chapter begins with a complete ordinary sentence.', before, after, 'A fourth paragraph describes the quiet room.', 'The final paragraph brings the chapter to its end.'];
const ordinary = ['The room contains many carefully chosen objects.', 'A reader can browse while the narrator continues.'];
const pageBodies = bodies.map((text, index) => index === 2 ? [text, ...ordinary] : [...ordinary, text]);
function marginPdf() {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'], pages = [];
  for (let number = 1; number <= 5; number++) {
    const id = objects.length + 1; pages.push(`${id} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 680] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const header = `${number + 40} Book One: 1805 Chapter I`, escape = text => text.replace(/[\\()]/g, '\\$&');
    let y = number === 1 ? 500 : 593;
    const body = pageBodies[number - 1].map(text => { const lines = text.match(/.{1,64}(?:\s|$)/g); return lines.map(line => { const command = `BT /F1 12 Tf 54 ${y} Td (${escape(line.trim())}) Tj ET`; y -= 14; return command; }).join(' ') + (y -= 16, ' '); }).join(' ');
    const stream = `BT /F1 8 Tf 54 630 Td (${header}) Tj ET BT /F1 11 Tf 54 613 Td (h [a\\\\ g) Tj ET ` +
      (number === 1 ? 'BT /F1 24 Tf 54 560 Td (Chapter I) Tj ET ' : '') +
      body + ` BT /F1 8 Tf 54 86 Td (${number + 40} War and Peace) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /D /St 41 >>] >> >>';
  objects[1] = `<< /Type /Pages /Kids [${pages.join(' ')}] /Count 5 >>`;
  let pdf = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  return Buffer.from(pdf + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
}
const bytes = marginPdf(), labels = ['41', '42', '43', '44', '45'];
const legacy = pageBodies.flatMap((paragraphs, index) => [{ text: `${index + 41} Book One: 1805 Chapter I`, page: index + 1, heading: true }, ...(index === 0 ? [{ text: 'h [a\\ g', page: 1, heading: false }, { text: 'Chapter I', page: 1, heading: true }] : []), ...paragraphs.map((text, line) => ({ text: (index > 0 && line === 0 ? 'h [a\\ g ' : '') + text, page: index + 1, heading: false })), { text: `${index + 41} War and Peace`, page: index + 1, heading: true }]);
const targetIndex = legacy.findIndex(segment => segment.text.endsWith(before));
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
let app, page; const checks = [], errors = [];
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1480, 960); win.webContents.setAudioMuted(true); globalThis.__marginRequests = [];
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async (_, request) => { globalThis.__marginRequests.push(request); return { samples: new Float32Array(384000).fill(.1), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }; });
  });
}
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function stored(key) { return page.evaluate(key => new Promise(resolve => { const open = indexedDB.open('keyval-store'); open.onsuccess = () => { const db = open.result, tx = db.transaction('keyval'), request = tx.objectStore('keyval').get(key); request.onsuccess = () => resolve(request.result instanceof Blob ? { size: request.result.size } : request.result); tx.oncomplete = () => db.close(); }; }), key); }
async function seed(id, title, segments, bytes, pageLabels, pageCount, index) {
  await page.evaluate(({ id, title, segments, bytes, pageLabels, pageCount, index }) => new Promise(resolve => {
    const open = indexedDB.open('keyval-store'); open.onsuccess = () => { const db = open.result, tx = db.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval'), request = store.get('cadence-library-index-v2');
      request.onsuccess = () => { const template = request.result[0]; store.put([{ ...template, id, title, kind: 'PDF', segmentCount: segments.length, wordCount: 500, pageCount, pageLabels, topics: [], navigationSource: 'none', position: index, bookmarks: [index], bookmarkPreviews: { [index]: segments[index] } }, ...request.result], 'cadence-library-index-v2'); store.put(segments, 'cadence-text:' + id); store.put(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), 'cadence-file:' + id); };
      tx.oncomplete = () => { db.close(); localStorage.setItem('cadence-reader-session-v1', JSON.stringify({ lastId: id, books: { [id]: { page: segments[index].page, segment: index, original: true } } })); resolve(); };
    };
  }), { id, title, segments, bytes: Array.from(bytes), pageLabels, pageCount, index });
  await page.reload(); await menuClick(page.locator('.recent-document').filter({ hasText: title })); await page.getByRole('heading', { name: title, exact: true }).waitFor();
  const mode = page.getByRole('button', { name: 'Document view', exact: true }); if (await mode.getAttribute('class') !== 'active') await mode.click();
  const jump = page.getByLabel('Go to original page', { exact: true }); await jump.fill(String(segments[index].page)); await jump.press('Enter');
  await page.waitForFunction(number => document.querySelector('.pdf-document')?.dataset.page === String(number), segments[index].page);
}
async function clickPdfWord(number, word) {
  const text = page.locator(`[data-pdf-page="${number}"] .pdf-text-layer span`).filter({ hasText: word }).last(); await text.waitFor();
  await text.evaluate(element => { const root = element.closest('.reader-scroll'); root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 200, behavior: 'instant' }); });
  await page.waitForFunction(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }, await text.elementHandle());
  const point = await text.evaluate((element, word) => { const at = element.textContent.lastIndexOf(word), range = new Range(); range.setStart(element.firstChild, at); range.setEnd(element.firstChild, at + word.length); const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }, word);
  await page.mouse.click(point.x, point.y); await page.getByLabel('Pause narration', { exact: true }).waitFor(); await page.getByLabel('Pause narration', { exact: true }).click();
  return app.evaluate(() => globalThis.__marginRequests.filter(request => request.priority === 'interactive').at(-1)?.text);
}
try {
  await start(); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await seed('old-margins', 'Already saved PDF', legacy, bytes, labels, 5, targetIndex);
  await check('An already-saved PDF skips numbered margins and ornaments across pages with exact native word/cue offsets', async () => {
    assert.equal(await clickPdfWord(2, 'which'), 'which ' + after);
    await page.waitForFunction(() => [...(CSS.highlights.get('cadence-pdf-speech') || [])].map(range => range.toString()).join(' ').includes('which she'));
    const cues = await page.evaluate(() => [...CSS.highlights.get('cadence-pdf-speech')].map(range => range.toString()).join(' ')); assert(!/War and Peace|Book One|\[a\\/.test(cues));
    assert(await page.locator('[data-pdf-page="2"] .pdf-text-layer span').filter({ hasText: 'War and Peace' }).count());
    assert.deepEqual(await stored('cadence-text:old-margins'), legacy); assert.deepEqual((await stored('cadence-library-index-v2')).find(item => item.id === 'old-margins').bookmarks, [targetIndex]);
  });
  await check('WAV export uses the same exclusions while retaining a genuine Chapter I and original PDF bytes', async () => {
    await app.evaluate(() => { globalThis.__marginRequests = []; }); await page.mouse.move(20, 20); await page.getByRole('button', { name: 'Export audio', exact: true }).click();
    await page.getByLabel('Audio format', { exact: true }).selectOption('wav');
    await page.getByRole('button', { name: 'Create audio file', exact: true }).click(); await page.getByRole('button', { name: 'Save WAV', exact: true }).waitFor();
    const text = await app.evaluate(() => globalThis.__marginRequests.map(request => request.text).join(' ')); assert(!/War and Peace|Book One|\[a\\/.test(text)); assert.equal((text.match(/Chapter I/g) || []).length, 1);
    assert.equal((await stored('cadence-file:old-margins')).size, bytes.length); await page.getByLabel('Close dialog', { exact: true }).click();
  });
  await check('New imports remove 13-percent small-font margins without deleting the real chapter heading', async () => {
    await page.locator('input[type=file]').setInputFiles({ name: 'Fresh margins.pdf', mimeType: 'application/pdf', buffer: bytes }); await page.getByRole('heading', { name: 'Fresh margins', exact: true }).waitFor();
    const item = (await stored('cadence-library-index-v2')).find(item => item.title === 'Fresh margins'), text = await stored('cadence-text:' + item.id);
    assert(!text.some(segment => /War and Peace|Book One|\[a\\/.test(segment.text))); assert.equal(text.filter(segment => segment.text === 'Chapter I').length, 1);
    await page.getByRole('button', { name: 'Document view', exact: true }).click(); const jump = page.getByLabel('Go to original page', { exact: true }); await jump.fill('2'); await jump.press('Enter');
    assert.equal(await clickPdfWord(2, 'which'), 'which ' + after); await page.screenshot({ path: path.join(output, staged ? 'staged-original.png' : 'source-original.png') });
  });
  if (fixture) await check('The actual War and Peace page 28/29 break narrates which she without altering saved text', async () => {
    const { build } = await import('esbuild'), compiled = await build({ entryPoints: ['src/paragraphs.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
    const { pdfParagraphs } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'), raw = await readFile(fixture), task = pdfjs.getDocument({ data: new Uint8Array(raw) }), pdf = await task.promise, pageLabels = await pdf.getPageLabels() || [], segments = [];
    for (let number = 25; number <= 35; number++) { const sheet = await pdf.getPage(number), text = await sheet.getTextContent(); segments.push(...pdfParagraphs(text.items.filter(item => 'str' in item), number)); sheet.cleanup(); }
    const index = segments.findIndex(segment => segment.text.endsWith('charming defect, which')); assert(index >= 0); const count = pdf.numPages; await task.destroy();
    await seed('real-margins', 'War and Peace margin check', segments, raw, pageLabels, count, index);
    assert.equal(await clickPdfWord(28, 'which'), 'which she neither wished, nor could, nor considered it necessary, to correct.'); assert.deepEqual(await stored('cadence-text:real-margins'), segments);
    await page.screenshot({ path: path.join(output, staged ? 'staged-real.png' : 'source-real.png') });
  });
  await check('Restart remains paused and the original library records and bookmarks retain their indices', async () => {
    await app.close(); app = undefined; await start(); await page.getByRole('heading', { name: fixture ? 'War and Peace margin check' : 'Fresh margins', exact: true }).waitFor(); await page.getByLabel('Play narration', { exact: true }).waitFor();
    assert.deepEqual(await stored('cadence-text:old-margins'), legacy); assert.deepEqual((await stored('cadence-library-index-v2')).find(item => item.id === 'old-margins').bookmarks, [targetIndex]); assert.deepEqual(errors, []);
  });
  await writeFile(path.join(output, staged ? 'staged-results.json' : 'source-results.json'), JSON.stringify({ checks, errors, staged, profile: env.CADENCE_DATA_DIR, fixture: fixture ? path.basename(fixture) : undefined }, null, 2));
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
finally { await app?.close(); }
