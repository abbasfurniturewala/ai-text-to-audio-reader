import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord, dispatchReaderWord } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = process.argv.includes('--staged');
await mkdir('test-results/fixtures', { recursive: true });
function fixture() {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const pages = [];
  for (let page = 1; page <= 5; page++) {
    const id = objects.length + 1;
    pages.push(`${id} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const stream = 'BT /F1 12 Tf 48 735 Td ' + Array.from({ length: 8 }, (_, i) => `${i ? '0 -64 Td ' : ''}(On page ${page} passage ${i + 1} we follow a calm story through the trees.) Tj`).join(' ') + ' ET';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pages.join(' ')}] /Count 5 >>`;
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}
await writeFile('test-results/fixtures/Five pages.pdf', fixture());
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/browse-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: [...(staged ? [] : ['.']), '--force-device-scale-factor=1'], env, timeout: 60000 });
const page = await app.firstWindow();
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
const position = () => page.locator('.current-passage').getAttribute('aria-label');
const scrollTop = () => page.locator('.reader-scroll').evaluate(element => element.scrollTop);
async function waitForProgress(previous) { await page.waitForFunction(previous => document.querySelector('.current-passage')?.getAttribute('aria-label') !== previous, previous); }
async function scrollAway() {
  const box = await page.locator('.reader-scroll').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 1400);
  await page.waitForTimeout(150);
}
try {
  await app.evaluate(({ ipcMain }) => {
    globalThis.__browseRequests = [];
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__browseRequests.push(request);
      await new Promise(resolve => setTimeout(resolve, 35));
      return { samples: Float32Array.from({ length: 72000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
  await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Five pages.pdf');
  await page.getByRole('heading', { name: 'Five pages', exact: true }).waitFor();
  const paragraphs = page.locator('.passage');
  assert.ok(await paragraphs.count() > 0 && await paragraphs.count() <= 40);
  await check('Reading view stays where you scroll while narration advances', async () => {
    assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await scrollAway();
    const top = await scrollTop(), prior = await position();
    assert.ok(top > 1000);
    await waitForProgress(prior); await waitForProgress(await position());
    assert.ok(Math.abs(await scrollTop() - top) < 2, 'Playback pulled the viewport back');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
  });
  await check('Go to audio returns without enabling automatic following', async () => {
    await page.getByRole('button', { name: 'Go to audio', exact: true }).click();
    assert.ok(await scrollTop() < 1000);
    assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'), 'false');
  });
  await check('Pausing and resuming does not move the browsing position', async () => {
    await scrollAway(); const top = await scrollTop();
    await page.getByLabel('Pause narration', { exact: true }).click();
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok(Math.abs(await scrollTop() - top) < 2);
  });
  await check('Follow audio is optional and scrolling immediately turns it off', async () => {
    const follow = page.getByRole('button', { name: 'Follow audio', exact: true });
    await follow.click(); assert.equal(await follow.getAttribute('aria-pressed'), 'true');
    await waitForProgress(await position());
    const visible = await page.locator('.current-passage').evaluate(element => { const a = element.getBoundingClientRect(), b = element.closest('.reader-scroll').getBoundingClientRect(); return a.top >= b.top && a.top < b.bottom; });
    assert.ok(visible);
    await scrollAway(); assert.equal(await follow.getAttribute('aria-pressed'), 'false');
    const top = await scrollTop(); await waitForProgress(await position());
    assert.ok(Math.abs(await scrollTop() - top) < 2);
  });
  await check('Clicking a word farther down moves narration without pulling the view', async () => {
    await page.locator('[data-location-key="page-5"]').scrollIntoViewIfNeeded();
    await clickReaderWord(page.locator('[data-passage-index="32"]'), 'calm');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    assert.ok((await position()).startsWith('Read from passage 33:'));
    const top = await scrollTop(); await waitForProgress(await position());
    assert.ok(Math.abs(await scrollTop() - top) < 2);
    assert.ok((await app.evaluate(() => globalThis.__browseRequests)).some(request => request.text.startsWith('calm story through the trees.')));
  });
  await check('Original PDF page five stays open while audio continues on page one', async () => {
    await page.getByLabel('Go to original page', { exact: true }).fill('1');
    await page.getByLabel('Go to original page', { exact: true }).press('Enter');
    await dispatchReaderWord(page.locator('[data-passage-index="0"]'));
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Document view', exact: true }).click();
    await page.getByLabel('Go to original page', { exact: true }).fill('1');
    await page.getByLabel('Go to original page', { exact: true }).press('Enter');
    for (let i = 0; i < 4; i++) await page.getByLabel('Next PDF page', { exact: true }).click();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await page.getByText('Page 5 of 5', { exact: true }).waitFor();
    await page.waitForTimeout(3400);
    await page.getByText('Page 5 of 5', { exact: true }).waitFor();
    await page.getByText('Audio on page 1', { exact: true }).waitFor();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
  });
  await check('A word on PDF page five starts narration there', async () => {
    const point = await page.locator('.pdf-text-layer span').filter({ hasText: 'On page 5 passage 1' }).evaluate(element => {
      const at = element.textContent.indexOf('calm');
      const range = document.createRange(); range.setStart(element.firstChild, at + 1); range.setEnd(element.firstChild, at + 3);
      const rect = range.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.getByText('Audio on page 5', { exact: true }).waitFor();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByText('Page 5 of 5', { exact: true }).waitFor();
  });
  await check('PDF page navigation suspends following and Go to audio returns', async () => {
    const follow = page.getByRole('button', { name: 'Follow audio', exact: true });
    await follow.click();
    await page.getByLabel('Previous PDF page', { exact: true }).click();
    assert.equal(await follow.getAttribute('aria-pressed'), 'false');
    await page.getByText('Page 4 of 5', { exact: true }).waitFor();
    await page.waitForTimeout(1100);
    await page.getByText('Page 4 of 5', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Go to audio', exact: true }).click();
    await page.getByText('Page 5 of 5', { exact: true }).waitFor();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await page.locator('.pdf-text-layer span').filter({ hasText: 'On page 5 passage 1' }).waitFor();
    await page.screenshot({ path: 'test-results/free-browse.png' });
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/browse-results.json', JSON.stringify({ checks, errors, staged }, null, 2));
} catch (error) { await page.screenshot({ path: 'test-results/browse-failure.png' }); throw error; }
finally { await app.close(); }
