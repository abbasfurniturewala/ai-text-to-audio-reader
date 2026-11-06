import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { menuClick } from './reader-qa-helpers.mjs';
import { findVoice } from '../src/voices.ts';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const args = process.argv.slice(2), staged = args.includes('--staged'), packaged = args.includes('--packaged');
const coldCache = args.includes('--cold-cache');
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const version = JSON.parse(await readFile('package.json', 'utf8')).version, voice = option('--voice') || 'af_heart';
const selected = findVoice(voice); if (!selected || voice.startsWith('blend_')) throw new Error('Choose a bundled preset voice for this benchmark.');
const output = path.resolve('test-results/export-benchmark'), tag = option('--tag') || (staged ? 'staged' : packaged ? 'installed' : 'source');
await mkdir(output, { recursive: true });
const text = [
  'A quiet beginning',
  'The first light reached the window before the town began to stir. Across the square, a shopkeeper opened the shutters and placed a small wooden chair beside the door. Nothing remarkable had happened, yet the morning already felt different.',
  'At half past seven, three travellers arrived with a map, two notebooks, and a question about the road beyond the river. They had walked twelve kilometres through the night. Now they wanted a warm breakfast and a reliable answer.',
  'The shopkeeper listened carefully, then pointed to a narrow lane behind the old stone bridge. “Follow that lane until you reach the orchard,” she said. “If the gate is closed, ask for Anna; she knows the way.”',
  'A different perspective',
  'Good decisions often begin with patient observation. A useful explanation connects evidence with consequences, considers several possibilities, and leaves room for uncertainty. The most confident answer is not always the most accurate one.',
  'The travellers agreed to compare their notes before setting out again. Each had noticed something different along the same road: a broken sign, the sound of running water, or a light in a distant house. Together, those details made the journey easier to understand.',
].join('\n\n');
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
const app = await _electron.launch({ executablePath: packaged ? path.resolve('release/win-unpacked/Cadence.exe') : staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged || packaged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow(), errors = []; page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
try {
  await app.evaluate(({ ipcMain, BrowserWindow }, coldCache) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    const original = ipcMain._invokeHandlers.get('reader:synthesize'); globalThis.__exportRequests = [];
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async (...args) => {
      const request = args[1]; if (coldCache && request.priority === 'background') throw new Error('Benchmark disables reader prewarm');
      const item = { characters: request.text.length, voice: request.voice, priority: request.priority, started: performance.now() }; globalThis.__exportRequests.push(item);
      try { const audio = await original(...args); item.wallMs = performance.now() - item.started; item.timing = audio.timing; item.rawSeconds = audio.samples.length / audio.sampleRate; item.transferBytes = audio.bytes.byteLength + audio.samples.byteLength; return audio; }
      catch (error) { item.error = error.message; throw error; }
    });
  }, coldCache);
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await menuClick(page.getByLabel('Paste text', { exact: true })); await page.getByLabel('Document title', { exact: true }).fill('Export timing fixture'); await page.getByLabel('Your text', { exact: true }).fill(text); await page.getByRole('button', { name: 'Add to my library' }).click();
  await page.getByRole('heading', { name: 'Export timing fixture', exact: true }).waitFor();
  if (voice !== 'af_heart') { await page.getByLabel('Filter voices').selectOption('Extended voices'); await page.locator('.voice-option').filter({ has: page.getByText(selected.name, { exact: true }) }).click(); }
  await page.mouse.move(20, 20); await page.getByRole('button', { name: 'Export audio', exact: true }).click();
  if (await page.getByLabel('Audio format', { exact: true }).count()) await page.getByLabel('Audio format', { exact: true }).selectOption('wav');
  const deadline = Date.now() + 120000;
  while (await app.evaluate(() => globalThis.__exportRequests.some(request => request.wallMs === undefined && !request.error))) { assert(Date.now() < deadline, 'Reader prewarm did not settle'); await page.waitForTimeout(100); }
  await app.evaluate(() => { globalThis.__exportRequests = []; });
  const started = performance.now(); await page.getByRole('button', { name: 'Create audio file', exact: true }).click();
  await page.getByRole('button', { name: 'Save WAV', exact: true }).waitFor({ timeout: 300000 }); const createdMs = performance.now() - started;
  const requests = await app.evaluate(() => globalThis.__exportRequests), filename = path.join(output, `${tag}.wav`);
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, filename);
  const saving = performance.now(); await page.getByRole('button', { name: 'Save WAV', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Your audio has been saved' }).waitFor(); const saveMs = performance.now() - saving;
  const bytes = await readFile(filename); assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt32LE(40), bytes.length - 44); assert.deepEqual(errors, []); assert(!requests.some(request => request.error));
  const seconds = bytes.readUInt32LE(40) / 2 / bytes.readUInt32LE(24), generationMs = requests.reduce((sum, request) => sum + request.timing.generateMs, 0), loadMs = requests.reduce((sum, request) => sum + request.timing.loadMs, 0);
  const report = { tag, voice, characters: text.length, words: text.split(/\s+/).length, prewarm: coldCache ? 'Reader prewarm disabled only in this isolated profile to measure uncached export.' : 'Normal reader opening preload settled; export uses its small existing cache.', requests: requests.length, createdMs, saveMs, audioSeconds: seconds, generationMs, loadMs, otherMs: createdMs - generationMs - loadMs, timesRealtime: seconds / (createdMs / 1000), projectedOneHourMinutes: createdMs / seconds * 60 / 1000, wavBytes: bytes.length, transferBytes: requests.reduce((sum, request) => sum + request.transferBytes, 0), errors, profile: env.CADENCE_DATA_DIR, clips: requests };
  await writeFile(path.join(output, `${tag}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ ...report, clips: undefined }, null, 2));
} finally { await app.close(); }
