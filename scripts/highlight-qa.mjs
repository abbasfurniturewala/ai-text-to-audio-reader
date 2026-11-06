import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord, readerSpeechText, menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version, staged = process.argv.includes('--staged');
const output = path.resolve('test-results/speech-highlighting');
await mkdir(output, { recursive: true });
const first = 'The first sentence follows the audio clock with a calm, steady voice.';
const second = 'The second sentence changes the highlight when its own audio begins.';
const crossing = 'A sentence can continue across a page boundary with many carefully chosen words and still keep';
const ending = 'the original page layout while the voice finishes the thought.';
function fixture() {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'], pages = [];
  for (const lines of [[first, second, crossing], [ending, 'This separate sentence stays unmarked until its own clip begins.']]) {
    const id = objects.length + 1; pages.push(`${id} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const stream = 'BT /F1 12 Tf 48 720 Td ' + lines.map((line, i) => `${i ? '0 -52 Td ' : ''}(${line}) Tj`).join(' ') + ' ET';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'; objects[1] = `<< /Type /Pages /Kids [${pages.join(' ')}] /Count 2 >>`;
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  return body + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(body)}\n%%EOF`;
}
await writeFile(path.join(output, 'Follow the voice.pdf'), fixture());
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow(), checks = [], errors = [];
page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
const pdfText = () => page.evaluate(() => [...(CSS.highlights.get('cadence-pdf-speech') || [])].filter(range => range.startContainer.parentElement?.closest('.pdf-page-slot')?.dataset.current === 'true').map(range => range.toString()).join(' ').replace(/\s+/g, ' ').trim());
const readingText = () => readerSpeechText(page).then(parts => parts.join(''));
async function waitPdf(text) { await page.waitForFunction(text => [...(CSS.highlights.get('cadence-pdf-speech') || [])].filter(range => range.startContainer.parentElement?.closest('.pdf-page-slot')?.dataset.current === 'true').map(range => range.toString()).join(' ').replace(/\s+/g, ' ').trim() === text, text); }
async function pause() { await page.mouse.move(15, 15); await page.getByLabel('Pause narration', { exact: true }).click(); }
try {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480, 960);
    globalThis.__highlights = [];
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__highlights.push(request);
      return { samples: Float32Array.from({ length: 72000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
  await check('Original PDF remains available for PDFs and text notes open in Reading view', async () => {
    await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Document view', exact: true }).count(), 1);
    await page.locator('input[type=file]').setInputFiles(path.join(output, 'Follow the voice.pdf'));
    await page.getByRole('heading', { name: 'Follow the voice', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Document view', exact: true }).waitFor();
    assert.equal((await readerSpeechText(page)).length, 0);
  });
  await check('Reading highlight advances at sentence handoffs and freezes during pause', async () => {
    await clickReaderWord(page.locator('.passage').filter({ hasText: first }).first());
    await page.waitForFunction(first => [...(CSS.highlights.get('cadence-reading-speech') || [])].map(range => range.toString()).join('') === first, first);
    await pause(); const held = await readingText(); await page.waitForTimeout(650); assert.equal(await readingText(), held);
    await page.mouse.move(16, 16); await page.getByLabel('Play narration', { exact: true }).click();
    await page.waitForFunction(second => [...(CSS.highlights.get('cadence-reading-speech') || [])].map(range => range.toString()).join('') === second, second);
    await pause();
  });
  await check('Original page layout carries the same live sentence without restarting audio', async () => {
    const requests = await app.evaluate(() => globalThis.__highlights.length);
    await page.getByRole('button', { name: 'Document view', exact: true }).click(); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await waitPdf(second); assert.equal(await app.evaluate(() => globalThis.__highlights.length), requests);
    await page.screenshot({ path: path.join(output, staged ? 'staged-pdf-highlight.png' : 'source-pdf-highlight.png') });
    assert.ok(await page.locator('.pdf-page-slot[data-current="true"] canvas').evaluate(canvas => canvas.width > 0));
  });
  await check('Exact-word PDF starts highlight only the spoken suffix and survive resize', async () => {
    const point = await page.locator('.pdf-text-layer span').filter({ hasText: first }).evaluate(element => {
      const at = element.textContent.indexOf('calm'), range = new Range(); range.setStart(element.firstChild, at); range.setEnd(element.firstChild, at + 4);
      const rect = range.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y); await waitPdf('calm, steady voice.'); await pause();
    assert.ok((await app.evaluate(() => globalThis.__highlights)).some(request => request.text.startsWith('calm, steady voice.')));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 820));
    assert.equal(await pdfText(), 'calm, steady voice.');
    assert.ok(await page.evaluate(() => [...CSS.highlights.get('cadence-pdf-speech')].every(range => range.getBoundingClientRect().width > 0)));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1480, 960));
  });
  await check('Browsing another PDF page never moves narration or paints unrelated words', async () => {
    await page.getByLabel('Next PDF page', { exact: true }).click(); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    assert.equal(await pdfText(), '');
    assert.ok((await page.locator('.audio-navigation').innerText()).includes('Audio on page 1'));
    await page.getByRole('button', { name: 'Go to audio', exact: true }).click(); await page.locator('.pdf-loading').waitFor({ state: 'hidden' }); await waitPdf('calm, steady voice.');
  });
  await check('Speed changes preserve sentence highlighting and both sides of a page-spanning sentence map correctly', async () => {
    await page.getByRole('button', { name: 'Reading view', exact: true }).click();
    await clickReaderWord(page.locator('.passage').filter({ hasText: crossing }).first());
    await page.waitForFunction(crossing => [...(CSS.highlights.get('cadence-reading-speech') || [])].map(range => range.toString()).join('').startsWith(crossing), crossing);
    await pause();
    await page.getByLabel('Narration speed', { exact: true }).fill('1.5');
    await page.getByRole('button', { name: 'Document view', exact: true }).click(); await page.locator('.pdf-loading').waitFor({ state: 'hidden' }); await waitPdf(crossing);
    await page.getByLabel('Next PDF page', { exact: true }).click(); await page.locator('.pdf-loading').waitFor({ state: 'hidden' }); await waitPdf(ending);
    await page.mouse.move(17, 17); await page.getByLabel('Play narration', { exact: true }).click();
    await page.waitForFunction(crossing => document.querySelector('.audio-navigation>span')?.textContent.includes('page 2') && [...(CSS.highlights.get('cadence-pdf-speech') || [])].map(range => range.toString()).join(' ').startsWith(crossing), crossing);
    await page.getByRole('button', { name: 'Go to audio', exact: true }).click();
    assert.equal(await page.locator('.viewing-location').getAttribute('data-location'), 'page-2');
    await waitPdf('This separate sentence stays unmarked until its own clip begins.'); await pause();
  });
  await check('Full screen retains the original PDF sentence and returns to the same page', async () => {
    await page.getByLabel('Enter full screen', { exact: true }).click(); await page.locator('.app-shell.focus-mode').waitFor(); await page.waitForTimeout(350);
    await waitPdf('This separate sentence stays unmarked until its own clip begins.');
    await page.screenshot({ path: path.join(output, staged ? 'staged-fullscreen-highlight.png' : 'source-fullscreen-highlight.png') });
    await page.keyboard.press('Escape'); await page.locator('.app-shell:not(.focus-mode)').waitFor(); await page.waitForTimeout(350);
    await waitPdf('This separate sentence stays unmarked until its own clip begins.');
  });
  await check('Finishing playback clears the live highlight rather than leaving an active sentence', async () => {
    await page.mouse.move(18, 18); await page.getByLabel('Play narration', { exact: true }).click();
    await page.waitForFunction(() => !CSS.highlights.has('cadence-pdf-speech'));
  });
  await check('Closing the document releases all PDF highlight ranges and a reopened book stays paused', async () => {
    await page.getByLabel('Close document', { exact: true }).click();
    assert.equal(await page.evaluate(() => CSS.highlights.has('cadence-pdf-speech')), false);
    await menuClick(page.locator('.recent-document').filter({ hasText: 'Follow the voice' }));
    await page.getByRole('heading', { name: 'Follow the voice', exact: true }).waitFor();
    assert.equal((await readerSpeechText(page)).length, 0); assert.equal(await pdfText(), '');
    assert.deepEqual(errors, []);
  });
  await writeFile(path.join(output, staged ? 'staged-results.json' : 'source-results.json'), JSON.stringify({ checks, errors, staged, profile: env.CADENCE_DATA_DIR }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
finally { await app.close(); }
