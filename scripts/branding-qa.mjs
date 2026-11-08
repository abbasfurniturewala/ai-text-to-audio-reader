import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { NtExecutable, NtExecutableResource, Resource } from 'resedit';
import { menuClick, openMenu } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const staged = process.argv.includes('--staged'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = path.resolve(`test-results/branding/${staged ? 'staged' : 'source'}-${Date.now()}`); await mkdir(output, { recursive: true });
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
let app, page; const checks = [], errors = [], external = [], audits = [], frames = new Map();
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function pixels(bytes) { const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); let green = 0, opaque = 0; for (let at = 0; at < data.length; at += 4) { if (data[at + 3] < 128) continue; opaque++; if (data[at + 1] > data[at] + 4 && data[at + 1] > data[at + 2] + 2) green++; } return { green, opaque, width: info.width, height: info.height }; }
async function audit(label) {
  const result = await page.evaluate(() => {
    const violations = []; let checked = 0;
    for (const element of document.querySelectorAll('.app-shell, .app-shell *')) {
      const box = element.getBoundingClientRect(); if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight) continue;
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(element, pseudo); if (style.visibility !== 'visible' || Number(style.opacity) === 0 || (pseudo && ['none', 'normal'].includes(style.content))) continue;
        for (const property of ['color', 'backgroundColor', 'backgroundImage', 'borderTopColor', 'outlineColor', 'textDecorationColor', 'boxShadow']) {
          for (const match of style[property].matchAll(/rgba?\(([^)]+)\)/g)) { const values = match[1].match(/[\d.]+/g).map(Number), [r, g, b, alpha = 1] = values; if (alpha < .03) continue; checked++; if (g > r + 4 && g > b + 2) violations.push({ tag: element.tagName, class: String(element.className).slice(0, 100), pseudo, property, color: match[0] }); }
        }
      }
    }
    return { checked, violations: violations.slice(0, 30) };
  }); audits.push({ label, ...result }); assert.deepEqual(result.violations, [], JSON.stringify({ label, ...result })); assert(result.checked > 100);
}
try {
  await check('The Windows icon provides crisp blue artwork at every common taskbar and display size', async () => {
    const ico = await readFile('build/icon.ico'), count = ico.readUInt16LE(4); assert.equal(ico.readUInt16LE(2), 1);
    for (let index = 0; index < count; index++) { const at = 6 + index * 16, size = ico[at] || 256, length = ico.readUInt32LE(at + 8), offset = ico.readUInt32LE(at + 12), image = ico.subarray(offset, offset + length), colors = await pixels(image); assert.equal(colors.width, size); assert.equal(colors.height, size); assert.equal(colors.green, 0); assert(colors.opaque > size * size / 2); frames.set(size, image); }
    for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) assert(frames.has(size)); await writeFile(path.join(output, 'logo.png'), frames.get(256));
  });
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 }); page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1100, 760); BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true); }); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await check('The window logo and every embedded Windows executable icon match the new artwork', async () => {
    if (staged) {
      const executable = await readFile(`release/staged-${version}/win-unpacked/Cadence.exe`), resources = NtExecutableResource.from(NtExecutable.from(executable)), groups = Resource.IconGroupEntry.fromEntries(resources.entries); assert.equal(groups.length, 1);
      for (const [size, expected] of frames) { const icon = groups[0].icons.find(icon => (icon.width || 256) === size); assert(icon, `Missing executable icon at ${size}px`); const entry = resources.entries.find(entry => entry.type === 3 && entry.id === icon.iconID); assert(Buffer.from(entry.bin).equals(expected), `Executable ${size}px icon differs from the new artwork`); }
      const { extractFile } = require('@electron/asar'); assert(extractFile(path.resolve(`release/staged-${version}/win-unpacked/resources/app.asar`), 'desktop/icon.png').equals(frames.get(256)));
    }
    const base64 = await app.evaluate(({ nativeImage }, file) => nativeImage.createFromPath(file).toPNG().toString('base64'), path.resolve('desktop/icon.png'));
    const actual = Buffer.from(base64, 'base64'); await writeFile(path.join(output, 'windows-icon.png'), actual); const colors = await pixels(actual); assert.equal(colors.green, 0); assert(colors.opaque > 100); const image = await sharp(actual).ensureAlpha().raw().toBuffer(), expected = await sharp(frames.get(colors.width) || frames.get(256)).resize(colors.width, colors.height).ensureAlpha().raw().toBuffer(); assert.equal(image.length, expected.length); const error = image.reduce((sum, value, at) => sum + Math.abs(value - expected[at]), 0) / image.length; assert(error < 12, 'Windows executable/window icon differs from the new brand: ' + error);
  });
  await check('Reader text, controls and all voice avatar families have no residual green styling', async () => {
    await audit('reader'); const avatars = await page.locator('.voice-avatar').evaluateAll(elements => elements.map(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundImage }))); assert.equal(avatars.length, 24); await page.screenshot({ path: path.join(output, 'reader.png') });
  });
  await check('The Menu uses the same blue logo and keeps its existing accessible navigation', async () => {
    await openMenu(page); const logo = page.locator('.brand-symbol img'); await logo.waitFor(); assert(await logo.evaluate(image => image.complete && image.naturalWidth > 0)); assert.equal(await logo.getAttribute('alt'), ''); await audit('menu'); await page.screenshot({ path: path.join(output, 'menu.png') }); await page.getByLabel('Close menu', { exact: true }).click();
  });
  await check('Library, bookmarks, settings and pasted-text dialogs retain the slate-blue theme', async () => {
    await menuClick(page.getByRole('button', { name: /^My library/ })); await page.getByRole('heading', { name: 'Your words. Your rhythm.', exact: true }).waitFor(); await audit('library');
    await menuClick(page.getByRole('button', { name: /^Bookmarks/ })); await page.getByRole('heading', { name: 'Your bookmarks', exact: true }).waitFor(); await audit('bookmarks');
    await menuClick(page.getByRole('button', { name: 'Settings', exact: true })); await page.getByLabel('Playback buffer', { exact: true }).waitFor(); await audit('settings'); await page.getByLabel('Close dialog', { exact: true }).click();
    await menuClick(page.getByRole('button', { name: 'Text reader', exact: true })); await page.getByLabel('Your text', { exact: true }).fill('A small synthetic passage keeps the reader ready for an isolated theme and branding check.'); await audit('text reader'); await page.getByRole('button', { name: 'Add to my library', exact: true }).click(); await page.getByRole('heading', { name: 'Pasted text', exact: true }).waitFor();
  });
  await check('Export controls and the full-screen reader retain blue styling without starting audio', async () => {
    await menuClick(page.getByRole('button', { name: 'Audio exports', exact: true })); await page.getByRole('heading', { name: 'Audio exports', exact: true }).waitFor(); await audit('export manager'); await page.getByRole('button', { name: 'New export', exact: true }).click(); await page.getByLabel('Export model', { exact: true }).waitFor(); await audit('export dialog'); await page.getByLabel('Close dialog', { exact: true }).click(); await page.getByRole('button', { name: 'Back to reading', exact: true }).click();
    await page.getByLabel('Enter full screen', { exact: true }).click(); await page.locator('.app-shell.focus-mode').waitFor(); await page.waitForTimeout(350); await audit('full screen'); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.app-shell.focus-mode'));
  });
  await check('The logo and navigation fit the compact window without horizontal overflow', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700)); await openMenu(page); const geometry = await page.locator('.sidebar').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth })); assert(geometry.scroll <= geometry.width + 1); await audit('compact menu'); await page.screenshot({ path: path.join(output, 'compact-menu.png') });
  });
  await check('No renderer errors, external asset requests or automatic narration occur', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0); });
} catch (error) { errors.push(error.stack); process.exitCode = 1; console.error(error); if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
finally { await app?.close().catch(() => {}); await writeFile(path.join(output, 'report.json'), JSON.stringify({ staged, output, checks, errors, external, audits }, null, 2)); }
