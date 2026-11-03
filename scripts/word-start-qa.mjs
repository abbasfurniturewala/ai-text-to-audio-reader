import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
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
  await page.getByLabel('Paste text', { exact: true }).click();
  await page.getByLabel('Document title', { exact: true }).fill('Word navigation');
  await page.getByLabel('Your text', { exact: true }).fill('Before this point, listen carefully to the story. Then continue into the next sentence.\n\nThe second paragraph contains repeated words, repeated words, and a final ending.');
  await page.getByRole('button', { name: 'Add to my library' }).click();
  await page.waitForTimeout(900);
  await check('Quick start is the default', async () => {
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-startup-v2')), '0');
  });
  await check('Clicking a middle word starts at that exact word from idle', async () => {
    await page.locator('.passage').first().locator('.read-word').filter({ hasText: /^carefully$/ }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    const requests = await app.evaluate(() => globalThis.__words);
    assert.ok(requests.some(request => request.text.startsWith('carefully to the story.')));
    assert.ok((await page.locator('.current-passage').getAttribute('aria-label')).startsWith('Read from passage 1:'));
  });
  await check('Clicking while paused starts the selected repeated word', async () => {
    await page.getByLabel('Pause narration', { exact: true }).click();
    const word = page.locator('.passage').nth(1).locator('.read-word').filter({ hasText: /^repeated$/ }).nth(1);
    await word.click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    const requests = await app.evaluate(() => globalThis.__words);
    assert.ok(requests.some(request => request.text === 'repeated words, and a final ending.'));
  });
  await check('Search-highlighted words keep their exact source offsets', async () => {
    await page.getByLabel('Search document', { exact: true }).click();
    await page.getByLabel('Search document text', { exact: true }).fill('final ending');
    await page.locator('.read-word').filter({ hasText: /^ending$/ }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok((await app.evaluate(() => globalThis.__words)).some(request => request.text === 'ending.'));
    await page.getByLabel('Close search', { exact: true }).click();
  });
  await check('Dragging to select text does not start narration', async () => {
    await page.locator('.passage').first().locator('.read-word').filter({ hasText: /^Before$/ }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByLabel('Pause narration', { exact: true }).click();
    const before = await app.evaluate(() => globalThis.__words.length);
    await page.locator('.passage').first().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.querySelector('.read-word').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    assert.equal(await app.evaluate(() => globalThis.__words.length), before);
    await page.getByText('TAKE YOUR TIME', { exact: true }).waitFor();
    await page.evaluate(() => window.getSelection().removeAllRanges());
  });
  await check('Rapid clicks discard stale playback and use the latest word', async () => {
    await page.locator('.passage').first().evaluate(element => {
      [...element.querySelectorAll('.read-word')].find(word => word.textContent === 'listen').click();
    });
    await page.locator('.passage').nth(1).locator('.read-word').filter({ hasText: /^final$/ }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok((await app.evaluate(() => globalThis.__words)).some(request => request.text === 'final ending.'));
    assert.ok((await page.locator('.current-passage').textContent()).startsWith('The second paragraph'));
  });
  await check('Original PDF words are clickable at their displayed coordinates', async () => {
    await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Adventure.pdf');
    await page.getByRole('heading', { name: 'Adventure', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Original PDF', exact: true }).click();
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
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/word-start-results.json', JSON.stringify({ checks, errors, staged }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/word-start-failure.png' });
  console.log(await page.locator('.pdf-page').evaluate(element => element.outerHTML).catch(() => 'No PDF page'));
  throw error;
} finally { await app.close(); }
