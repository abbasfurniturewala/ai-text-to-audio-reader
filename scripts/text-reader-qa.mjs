import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { menuClick, clickReaderWord, readerSpeechText } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const staged = process.argv.includes('--staged'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = path.resolve(`test-results/text-reader/${staged ? 'staged' : 'source'}-${Date.now()}`); await mkdir(output, { recursive: true });
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile') }; delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
const paragraphs = ['A river carries the morning light past the trees, while a quiet breeze moves through the branches and brings a fresh beginning to the day.', 'The second passage offers another complete sentence for listening, with enough ordinary words to check bookmarks and starts from a particular word without any document file.'];
const spoken = 'Orchards are quiet places in the morning, where birds gather among the leaves and the first warm sunlight reaches the ground. We can listen to these ordinary words without importing a file.';
let app, page, native = ''; const checks = [], errors = [], external = [];
async function start() { app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 }); app.process().stderr.on('data', data => native = (native + data).slice(-50000)); page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); }); await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1100, 760); BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true); }); }
async function close() { if (!app) return; const closed = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed; app = null; }
async function reader() { await menuClick(page.getByRole('button', { name: 'Text reader', exact: true })); await page.getByRole('heading', { name: 'Text reader', exact: true }).waitFor(); }
async function reveal() { const button = page.getByRole('button', { name: 'Show playback controls', exact: true }); if (await button.isVisible()) await button.click(); }
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function paused() { await reveal(); const pause = page.getByLabel(/^(Pause narration|Cancel loading)$/); if (await pause.count()) await pause.click(); await page.getByLabel('Play narration', { exact: true }).waitFor(); }
try {
  await start(); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await check('Named Text reader needs no file, focuses its paste box and rejects blank input', async () => {
    await reader(); assert(await page.getByLabel('Your text', { exact: true }).evaluate(element => element === document.activeElement)); assert(await page.getByRole('button', { name: 'Read aloud', exact: true }).isDisabled());
    await page.getByLabel('Your text', { exact: true }).fill(' \n\t '); assert(await page.getByRole('button', { name: 'Add to my library', exact: true }).isDisabled()); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0);
  });
  await check('Closing a draft preserves it and leaves the current document in place', async () => {
    await page.getByLabel('Your text', { exact: true }).fill(paragraphs.join('\n\n')); await page.getByLabel('Close dialog', { exact: true }).click(); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor(); await reader(); assert.equal(await page.getByLabel('Your text', { exact: true }).inputValue(), paragraphs.join('\n\n'));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700)); const geometry = await page.locator('.dialog').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, height: element.getBoundingClientRect().height, screen: innerHeight })); assert(geometry.scroll <= geometry.width + 1 && geometry.height < geometry.screen); await page.getByRole('button', { name: 'Read aloud', exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'text-reader-dialog.png') });
  });
  await check('Optional title creates saved plain text in the regular reader without automatic playback', async () => {
    await page.getByRole('button', { name: 'Add to my library', exact: true }).click(); await page.getByRole('heading', { name: 'Pasted text', exact: true }).waitFor(); await page.locator('.passage').nth(1).waitFor(); assert.deepEqual(await page.locator('.passage').allTextContents(), paragraphs); await reveal(); assert(await page.getByLabel('Play narration', { exact: true }).isEnabled()); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0);
    await page.getByLabel('Speech cue', { exact: true }).selectOption('underline'); await page.getByRole('button', { name: 'Document view', exact: true }).click(); assert.equal(await page.locator('.app-shell').getAttribute('data-speech-cue'), 'underline');
  });
  await check('Pasted text uses real offline voices, exact-word starts, speed and bookmarks', async () => {
    assert.equal(await page.locator('.voice-option').count(), 23); await page.getByRole('button', { name: 'Reading view', exact: true }).click(); await page.getByLabel('Narration speed', { exact: true }).press('ArrowRight');
    await clickReaderWord(page.locator('.passage').nth(1), 'another'); await page.waitForFunction(() => (CSS.highlights.get('cadence-reading-speech')?.size || 0) > 0, null, { timeout: 60000 }); assert((await readerSpeechText(page)).join('').startsWith('another complete sentence'));
    await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Reading progress"]').value) > 0); await paused(); await page.getByLabel('Bookmark viewed passage', { exact: true }).click();
  });
  await check('Read aloud saves and plays the newly pasted text rather than the previous book', async () => {
    await reader(); await page.getByLabel('Your text', { exact: true }).fill(spoken); await page.getByLabel('Document title', { exact: true }).fill('Words without a file'); await page.getByRole('button', { name: 'Read aloud', exact: true }).click(); await page.getByRole('heading', { name: 'Words without a file', exact: true }).waitFor();
    await page.waitForFunction(() => [...(CSS.highlights.get('cadence-reading-speech') || [])].some(range => range.toString().startsWith('Orchards')), null, { timeout: 60000 }); await page.waitForFunction(() => Number(document.querySelector('input[aria-label="Reading progress"]').value) > 0); await paused();
  });
  await check('A save failure keeps the pasted draft visible and does not start narration', async () => {
    await page.waitForTimeout(700); await reader(); await page.getByLabel('Your text', { exact: true }).fill('This draft remains available if saving text temporarily fails on the local device.');
    await page.evaluate(() => { const original = IDBObjectStore.prototype.put; window.__restoreTextPut = () => { IDBObjectStore.prototype.put = original; }; IDBObjectStore.prototype.put = function(value, key) { if (String(key).startsWith('cadence-text:')) throw new DOMException('Temporary text save failure', 'QuotaExceededError'); return original.call(this, value, key); }; });
    try { await page.getByRole('button', { name: 'Read aloud', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'Temporary text save failure' }).waitFor(); assert((await page.getByLabel('Your text', { exact: true }).inputValue()).startsWith('This draft remains')); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0); }
    finally { await page.evaluate(() => window.__restoreTextPut()); } await page.getByLabel('Close dialog', { exact: true }).click();
  });
  await check('Pasted text survives full restart, keeps its reader preferences and remains paused', async () => {
    await close(); await start(); await page.getByRole('heading', { name: 'Words without a file', exact: true }).waitFor(); await reveal(); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0); assert(await page.getByLabel('Play narration', { exact: true }).isVisible()); assert.equal(await page.locator('.app-shell').getAttribute('data-speech-cue'), 'underline');
    await menuClick(page.getByRole('button', { name: 'My library 3', exact: true })); await page.getByRole('button', { name: 'Paste text instead', exact: true }).click(); await page.getByRole('heading', { name: 'Text reader', exact: true }).waitFor(); await page.getByLabel('Close dialog', { exact: true }).click();
    await menuClick(page.getByRole('button', { name: 'Bookmarks 1', exact: true })); await page.locator('.bookmark-card').filter({ hasText: 'Pasted text' }).click(); await page.getByRole('heading', { name: 'Pasted text', exact: true }).waitFor();
  });
  await check('Saved pasted text supports the normal chaptered audiobook export', async () => {
    await menuClick(page.getByRole('button', { name: 'Audio exports', exact: true })); await page.getByRole('button', { name: 'New export', exact: true }).click(); await page.getByLabel('Export model', { exact: true }).selectOption('kokoro-cuda');
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, path.join(output, 'pasted-text.m4b'));
    await page.getByRole('button', { name: 'Create M4B audiobook', exact: true }).click(); const deadline = Date.now() + 120000;
    while (true) { const job = await page.evaluate(async () => (await window.cadence.exportJobs())[0]); assert.notEqual(job?.status, 'error', job?.message); if (job?.status === 'complete') break; assert(Date.now() < deadline, 'The text audiobook did not finish.'); await page.waitForTimeout(100); }
    assert((await stat(path.join(output, 'pasted-text.m4b'))).size > 1000);
  });
  await check('No renderer errors, unwanted restart playback or external text/audio requests occur', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(await page.getByLabel('Pause narration', { exact: true }).count(), 0); });
} catch (error) { errors.push(error.stack); console.error(error); process.exitCode = 1; if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); }
finally { await close().catch(() => {}); await writeFile(path.join(output, 'native.log'), native); await writeFile(path.join(output, 'report.json'), JSON.stringify({ staged, output, checks, errors, external }, null, 2)); }
