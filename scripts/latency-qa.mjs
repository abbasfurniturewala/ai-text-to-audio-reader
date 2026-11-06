import { createRequire } from 'node:module';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { clickReaderWord, menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const baseline = process.argv.includes('--baseline');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = process.argv.includes('--staged');
const packaged = baseline || staged;
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/latency-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: packaged ? path.resolve(staged ? `release/staged-${version}/win-unpacked/Cadence.exe` : 'release/win-unpacked/Cadence.exe') : require('electron'), args: packaged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow();
try {
  await page.getByRole('heading', { name: 'The art of paying attention' }).waitFor();
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('reader:synthesize');
    globalThis.__latencyRequests = [];
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async (...args) => {
      const item = { text: args[1].text, priority: args[1].priority, start: Date.now() };
      globalThis.__latencyRequests.push(item);
      try { const audio = await original(...args); item.end = Date.now(); item.timing = audio.timing; return audio; }
      catch (error) { item.error = error.message; throw error; }
    });
  });
  await menuClick(page.getByLabel('Paste text', { exact: true }));
  await page.getByLabel('Document title', { exact: true }).fill('Latency measurement');
  await page.getByLabel('Your text', { exact: true }).fill('A good story stays with you. Take a breath, settle in, and let the words come to you.\n\nA cup of coffee cooling beside an open window. The sound of rain finding its way through the trees.\n\nThere is a particular kind of quiet that arrives when you stop trying to do everything at once.');
  await page.getByRole('button', { name: 'Add to my library' }).click();
  await page.getByRole('heading', { name: 'Latency measurement', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.play-button')?.disabled);
  // Instrument the actual audio clock, including model initialization and preparation.
  await page.evaluate(() => {
    window.__timing = { starts: [] };
    const create = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function () {
      const source = create.call(this), original = source.start.bind(source);
      source.start = (...args) => { window.__timing.starts.push({ wall: performance.now(), clock: this.currentTime, at: args[0], duration: args[2] }); return original(...args); };
      return source;
    };
    window.__timing.clicked = performance.now();
    document.querySelector('.play-button').click();
  });
  await page.getByLabel('Pause narration', { exact: true }).waitFor({ timeout: 120000 });
  console.log('Measuring continuous playback with the real local voice.');
  await page.waitForTimeout(18000);
  const timing = await page.evaluate(() => window.__timing);
  timing.firstScheduledMs = Math.round(timing.starts[0].wall - timing.clicked);
  timing.requests = await app.evaluate(() => globalThis.__latencyRequests);
  timing.maxScheduleGapMs = Math.round(Math.max(0, ...timing.starts.slice(1).map((clip, i) => (clip.at - timing.starts[i].at - timing.starts[i].duration) * 1000)));
  if (!baseline) {
    const warmIndex = timing.starts.length;
    await page.locator('.passage').first().evaluate(element => element.addEventListener('click', () => { window.__timing.warmClicked = performance.now(); }, { once: true, capture: true }));
    await clickReaderWord(page.locator('.passage').first());
    await page.waitForFunction(index => window.__timing.starts.length > index, warmIndex);
    timing.preparedStartMs = await page.evaluate(index => Math.round(window.__timing.starts[index].wall - window.__timing.warmClicked), warmIndex);
    await page.mouse.move(8, 8);
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    const wordIndex = await page.evaluate(() => window.__timing.starts.length);
    const passage = page.locator('.passage').filter({ hasText: 'breath' }).first();
    await passage.evaluate(element => element.addEventListener('click', () => { window.__timing.wordClicked = performance.now(); }, { once: true, capture: true }));
    await clickReaderWord(passage, 'breath');
    await page.waitForFunction(index => window.__timing.starts.length > index, wordIndex);
    timing.uncachedWordStartMs = await page.evaluate(index => Math.round(window.__timing.starts[index].wall - window.__timing.wordClicked), wordIndex);
  }
  console.log(JSON.stringify(timing));
  await mkdir('test-results', { recursive: true });
  await writeFile(`test-results/latency-${baseline ? 'baseline' : 'updated'}.json`, JSON.stringify(timing, null, 2));
} finally { await app.close(); }
