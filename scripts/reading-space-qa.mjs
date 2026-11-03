import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fivePagePdf } from './pdf-fixture.mjs';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const staged = process.argv.includes('--staged');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir('test-results/fixtures', { recursive: true });
await writeFile('test-results/fixtures/Reading space.pdf', fivePagePdf());
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/reading-space-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow();
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
async function fullScreen(on) {
  await page.waitForFunction(on => document.querySelector('.app-shell').classList.contains('focus-mode') === on, on);
  assert.equal(await page.evaluate(() => window.cadence.fullScreen()), on);
}
async function jump(number) {
  await page.getByLabel('Go to original page', { exact: true }).fill(String(number));
  await page.getByLabel('Go to original page', { exact: true }).press('Enter');
  await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, number);
  await page.locator(`[data-location-key="page-${number}"] .read-word`).first().waitFor();
}
try {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 900);
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async () => ({ samples: Float32Array.from({ length: 240000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }));
  });
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Reading space.pdf');
  await page.getByRole('heading', { name: 'Reading space', exact: true }).waitFor();
  await jump(3);
  await check('The original player design is restored and the voice panel collapses without losing the browsed page', async () => {
    assert.equal((await page.locator('.player').boundingBox()).height, 132);
    assert.equal((await page.locator('.player .play-button').boundingBox()).height, 48);
    assert.equal(await page.locator('.now-playing-art').isVisible(), true);
    const before = await page.locator('.reader-scroll').boundingBox();
    await page.getByRole('button', { name: 'Hide voice panel', exact: true }).click();
    const after = await page.locator('.reader-scroll').boundingBox();
    assert.ok(after.width > before.width + 200);
    assert.equal(await page.locator('.voice-panel').isVisible(), false);
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-3');
    await page.getByRole('button', { name: 'Show voice panel', exact: true }).click();
    await page.getByRole('button', { name: 'Close voice panel', exact: true }).click();
    assert.equal(await page.locator('.voice-panel').isVisible(), false);
  });
  await check('Voice panel visibility survives restart', async () => {
    await page.reload();
    await page.getByRole('heading', { name: 'Reading space', exact: true }).waitFor();
    assert.equal(await page.locator('.voice-panel').isVisible(), false);
    await page.getByRole('button', { name: 'Show voice panel', exact: true }).click();
  });
  await jump(3);
  if (await page.getByRole('button', { name: 'Document navigation', exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByRole('button', { name: 'Document navigation', exact: true }).click();
  await page.locator('.play-button').click();
  await page.getByLabel('Pause narration', { exact: true }).waitFor();
  await check('Ten seconds of inactivity collapses the player; mouse activity resets the deadline and playback continues', async () => {
    const before = await page.locator('.reader-scroll').boundingBox();
    await page.mouse.move(20, 200);
    await page.waitForTimeout(8500);
    assert.equal(await page.locator('.player').isVisible(), true);
    await page.mouse.move(20, 210);
    await page.waitForTimeout(2000);
    assert.equal(await page.locator('.player').isVisible(), true);
    await page.locator('.player').waitFor({ state: 'hidden', timeout: 11000 });
    const after = await page.locator('.reader-scroll').boundingBox();
    assert.ok(after.height >= before.height + 100);
    assert.equal(await page.locator('.player .play-button').getAttribute('aria-label'), 'Pause narration');
    assert.equal(await page.locator('.viewing-location').getAttribute('data-location'), 'page-3');
    await page.screenshot({ path: 'test-results/player-idle-collapsed.png' });
    await page.mouse.move(20, 220);
    await page.locator('.player').waitFor({ state: 'visible' });
  });
  const normal = await page.locator('.reader-scroll').boundingBox();
  await page.screenshot({ path: 'test-results/reading-space-normal.png' });
  await check('Full screen maximizes the page, hides chrome, preserves browsing and keeps narration playing', async () => {
    await page.getByRole('button', { name: 'Enter full screen', exact: true }).click();
    await fullScreen(true);
    const reader = await page.locator('.reader-scroll').boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    assert.ok(reader.height >= viewport.height * .95);
    assert.ok(reader.width >= viewport.width * .95);
    assert.ok(reader.height > normal.height + 150);
    assert.equal(await page.locator('.voice-panel').isVisible(), false);
    assert.equal(await page.locator('.sidebar').isVisible(), false);
    assert.equal(await page.locator('.document-navigation').count(), 0);
    await page.locator('.focus-controls').getByLabel('Pause narration', { exact: true }).waitFor();
    assert.equal(await page.locator('.viewing-location').getAttribute('data-location'), 'page-3');
    await page.screenshot({ path: 'test-results/reading-space-fullscreen.png' });
  });
  await check('Full-screen player also hides after inactivity, reveals on movement, and remains keyboard accessible', async () => {
    const height = (await page.locator('.reader-scroll').boundingBox()).height;
    await page.locator('.player').waitFor({ state: 'hidden', timeout: 15000 });
    const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    await page.mouse.move(size.width / 2, size.height - 5);
    await page.locator('.player').waitFor({ state: 'visible' });
    assert.equal((await page.locator('.reader-scroll').boundingBox()).height, height);
    await page.locator('.player').getByRole('button', { name: 'Back 15 seconds', exact: true }).click();
    await page.locator('.focus-controls').getByRole('button', { name: 'Bookmark current passage', exact: true }).focus();
    await page.keyboard.press('Tab');
    await page.locator('.player').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.player-reveal').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.querySelector('.player').contains(document.activeElement)));
    await page.locator('.focus-controls').getByRole('button', { name: 'Exit full screen', exact: true }).focus();
    await page.locator('.player').waitFor({ state: 'hidden' });
  });
  await check('Side controls navigate independently, open temporary panels and adjust speed', async () => {
    const rail = page.locator('.focus-controls');
    await rail.getByRole('button', { name: 'Next document page', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.focus-page b').textContent === '4');
    await rail.getByRole('button', { name: 'Show voice panel', exact: true }).click();
    assert.equal(await page.locator('.voice-panel').isVisible(), true);
    await page.locator('.voice-option').filter({ hasText: 'George' }).click();
    await rail.getByLabel('Narration speed', { exact: true }).selectOption('1.25');
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-speed')), '1.25');
    await page.screenshot({ path: 'test-results/reading-space-voice-drawer.png' });
    await rail.getByRole('button', { name: 'Document navigation', exact: true }).click();
    assert.equal(await page.locator('.voice-panel').isVisible(), false);
    assert.equal(await page.locator('.document-navigation').isVisible(), true);
    await page.getByRole('button', { name: 'Close document navigation', exact: true }).click();
    await rail.getByRole('button', { name: 'Switch to original PDF', exact: true }).click();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    assert.ok(await page.locator('.pdf-page canvas').isVisible());
    assert.equal(await page.locator('.focus-page b').textContent(), '4');
  });
  await check('Escape restores the normal panels, and F11 enters and exits full screen', async () => {
    await page.keyboard.press('Escape'); await fullScreen(false);
    assert.equal(await page.locator('.sidebar').isVisible(), true);
    assert.equal(await page.locator('.voice-panel').isVisible(), true);
    assert.equal(await page.locator('.document-navigation').isVisible(), true);
    assert.equal(await page.locator('.player').isVisible(), true);
    assert.equal(await page.locator('.selected-voice h3').textContent(), 'George');
    await page.keyboard.press('F11'); await fullScreen(true);
    await page.keyboard.press('F11'); await fullScreen(false);
  });
  await check('Compact controls remain usable at 1024px', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
    const boxes = await page.locator('.player .play-button, .player .export-button, .topbar-actions').evaluateAll(elements => elements.map(element => { const bounds = element.getBoundingClientRect(); return { left: bounds.left, right: bounds.right }; }));
    assert.ok(boxes.every(box => box.left >= 0 && box.right <= 1024));
    assert.equal((await page.locator('.player').boundingBox()).height, 122);
    await page.screenshot({ path: 'test-results/reading-space-1024.png' });
  });
  await check('Changing panels preserves the visible point on an original PDF page', async () => {
    await page.locator('.reader-scroll').evaluate(element => element.scrollTo({ top: 250, behavior: 'instant' }));
    const fraction = () => page.evaluate(() => {
      const viewport = document.querySelector('.reader-scroll').getBoundingClientRect();
      const canvas = document.querySelector('.pdf-page canvas').getBoundingClientRect();
      return (viewport.top + 30 - canvas.top) / canvas.height;
    });
    const before = await fraction();
    await page.getByRole('button', { name: 'Hide voice panel', exact: true }).click();
    const after = await fraction();
    assert.ok(Math.abs(after - before) < .03, `PDF position moved from ${before} to ${after}`);
    await page.getByRole('button', { name: 'Show voice panel', exact: true }).click();
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/reading-space-results.json', JSON.stringify({ checks, errors, staged }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/reading-space-failure.png' });
  console.log(await page.getByRole('alert').allTextContents());
  throw error;
} finally { await app.close(); }
