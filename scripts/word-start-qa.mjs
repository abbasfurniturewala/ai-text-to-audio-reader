import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord, dispatchReaderWord, readerSpeechText, readerWordPoint, menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = process.argv.includes('--staged');
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/word-start-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow();
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
try {
  await app.evaluate(({ ipcMain }) => {
    globalThis.__words = [];
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__words.push(request);
      await new Promise(resolve => setTimeout(resolve, 200));
      const samples = Float32Array.from({ length: 48000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000));
      return { samples, bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
  await menuClick(page.getByLabel('Paste text', { exact: true }));
  await page.getByLabel('Document title', { exact: true }).fill('Word navigation');
  await page.getByLabel('Your text', { exact: true }).fill('Before this point, listen carefully to the story. Then continue into the next sentence.\n\nThe second paragraph contains repeated words, repeated words, and a final ending.');
  await page.getByRole('button', { name: 'Add to my library' }).click();
  await page.waitForTimeout(900);
  await check('Quick start is the default', async () => {
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-startup-v2')), '0');
  });
  await check('Clicking a middle word starts at that exact word from idle', async () => {
    await clickReaderWord(page.locator('.passage').first(), 'carefully');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    const requests = await app.evaluate(() => globalThis.__words);
    assert.ok(requests.some(request => request.text.startsWith('carefully to the story.')));
    assert.ok((await page.locator('.current-passage').getAttribute('aria-label')).startsWith('Read from passage 1:'));
  });
  await check('Clicking while paused starts the selected repeated word', async () => {
    await page.getByLabel('Pause narration', { exact: true }).click();
    await clickReaderWord(page.locator('.passage').nth(1), 'repeated', 1);
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    const requests = await app.evaluate(() => globalThis.__words);
    assert.ok(requests.some(request => request.text === 'repeated words, and a final ending.'));
  });
  await check('Search-highlighted words keep their exact source offsets', async () => {
    await page.getByLabel('Search document', { exact: true }).click();
    await page.getByLabel('Search document text', { exact: true }).fill('final ending');
    await clickReaderWord(page.locator('.passage').filter({ hasText: 'final ending' }).first(), 'ending');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok((await app.evaluate(() => globalThis.__words)).some(request => request.text === 'ending.'));
    await page.getByLabel('Close search', { exact: true }).click();
  });
  await check('Dragging to select text does not start narration', async () => {
    await clickReaderWord(page.locator('.passage').first(), 'Before');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByLabel('Pause narration', { exact: true }).click();
    const before = await app.evaluate(() => globalThis.__words.length);
    await page.locator('.passage').first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.equal(await app.evaluate(() => globalThis.__words.length), before);
    await page.getByText('TAKE YOUR TIME', { exact: true }).waitFor();
    await page.evaluate(() => window.getSelection().removeAllRanges());
  });
  await check('Rapid clicks discard stale playback and use the latest word', async () => {
    await dispatchReaderWord(page.locator('.passage').first(), 'listen');
    await clickReaderWord(page.locator('.passage').nth(1), 'final');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok((await app.evaluate(() => globalThis.__words)).some(request => request.text === 'final ending.'));
    assert.ok((await page.locator('.current-passage').textContent()).startsWith('The second paragraph'));
  });
  await check('The right edge of a final glyph still starts its containing word', async () => {
    await clickReaderWord(page.locator('.passage').first(), 'carefully', 0, 'right');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.waitForFunction(() => [...(CSS.highlights.get('cadence-reading-speech') || [])].map(range => range.toString()).join('').startsWith('carefully'));
    assert((await readerSpeechText(page)).join('').startsWith('carefully to the story.'));
  });
  await check('Original PDF words are clickable at their displayed coordinates', async () => {
    await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Adventure.pdf');
    await page.getByRole('heading', { name: 'Adventure', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Document view', exact: true }).click();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    const point = await page.locator('.pdf-text-layer span').filter({ hasText: 'natural local voice.' }).evaluate(element => {
      const at = element.textContent.indexOf('natural');
      const range = document.createRange(); range.setStart(element.firstChild, at + 1); range.setEnd(element.firstChild, at + 4);
      const rect = range.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok((await app.evaluate(() => globalThis.__words)).some(request => request.text === 'natural local voice.'));
    await page.screenshot({ path: 'test-results/pdf-word-navigation.png' });
  });
  await check('Native Unicode text retains exact glyph starts, search and exclusive hover cues', async () => {
    await menuClick(page.getByLabel('Paste text', { exact: true })); await page.getByLabel('Document title', { exact: true }).fill('Native Unicode');
    const text = 'A traveller visits the café, sharing naïve ideas and a résumé. العربية مرحبا بالعالم. The final words stay readable.';
    await page.getByLabel('Your text', { exact: true }).fill(text); await page.getByRole('button', { name: 'Add to my library' }).click();
    await page.getByRole('heading', { name: 'Native Unicode', exact: true }).waitFor();
    const passage = page.locator('.passage').first(); await passage.locator('[data-reader-text]').waitFor();
    assert.equal(await passage.locator('[data-reader-text]').textContent(), text); assert.equal(await page.locator('.read-word').count(), 0);
    assert.equal(await passage.locator('[aria-hidden="true"]').count(), 0);
    let point = await readerWordPoint(passage, 'café'); await page.mouse.move(point.x, point.y);
    await page.waitForFunction(() => [...(CSS.highlights.get('cadence-reading-hover') || [])].map(range => range.toString()).join('') === 'café');
    await clickReaderWord(passage, 'café', 0, 'right'); await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert((await app.evaluate(() => globalThis.__words)).some(request => request.priority === 'interactive' && request.text.startsWith('café, sharing naïve ideas')));
    await page.waitForFunction(() => !CSS.highlights.has('cadence-reading-hover')); await page.getByLabel('Pause narration', { exact: true }).click();
    await clickReaderWord(passage, 'مرحبا', 0, 'right'); await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert((await app.evaluate(() => globalThis.__words)).some(request => request.priority === 'interactive' && request.text.startsWith('مرحبا بالعالم.')));
    await page.getByLabel('Pause narration', { exact: true }).click();
    await page.getByLabel('Search document', { exact: true }).click(); await page.getByLabel('Search document text', { exact: true }).fill('naïve ideas');
    await page.waitForFunction(() => [...(CSS.highlights.get('cadence-reading-search') || [])].map(range => range.toString()).join('') === 'naïve ideas');
    await page.getByLabel('Close search', { exact: true }).click();
    await page.getByLabel('Close document', { exact: true }).click();
    assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].filter(name => name.startsWith('cadence-reading-')).length), 0);
  });
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/word-start-results.json', JSON.stringify({ checks, errors, staged }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/word-start-failure.png' });
  console.log(await page.locator('.pdf-page').evaluate(element => element.outerHTML).catch(() => 'No PDF page'));
  throw error;
} finally { await app.close(); }
