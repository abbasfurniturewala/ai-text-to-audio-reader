import { menuClick } from './reader-qa-helpers.mjs';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/buffering-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged') || process.argv.includes('--staged');
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const exe = packaged ? path.resolve(process.env.CADENCE_QA_EXECUTABLE || (process.argv.includes('--staged') ? `release/staged-${version}/win-unpacked/Cadence.exe` : 'release/win-unpacked/Cadence.exe')) : require('electron');
const app = await _electron.launch({ executablePath: exe, args: packaged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.__audioRuns = [];
  window.__activeAudioRun = () => [...window.__audioRuns].reverse().find(run => run.starts.length && run.context.state !== 'closed') || [...window.__audioRuns].reverse().find(run => run.starts.length);
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(options) {
      super(options);
      const entry = { context: this, starts: [], samples: [] }; window.__audioRuns.push(entry);
      const original = this.createBufferSource.bind(this);
      this.createBufferSource = () => {
        const node = original(), start = node.start.bind(node), stop = node.stop.bind(node);
        let record;
        node.start = (at, offset, duration) => {
          record = { at, offset, duration, rate: node.playbackRate.value, preparedAt: this.currentTime, stopped: false };
          entry.starts.push(record); return start(at, offset, duration);
        };
        node.stop = (...args) => { if (record) record.stopped = true; return stop(...args); };
        return node;
      };
    }
  };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (...args) {
    const result = connect.apply(this, args);
    if (args[0] === this.context.destination) {
      const entry = window.__audioRuns.find(run => run.context === this.context);
      if (entry && !entry.analyser) {
        const analyser = this.context.createAnalyser(); analyser.fftSize = 512;
        entry.analyser = analyser;
        const data = new Float32Array(512);
        const timer = setInterval(() => {
          if (this.context.state === 'closed') { clearInterval(timer); return; }
          analyser.getFloatTimeDomainData(data);
          entry.samples.push({ at: this.context.currentTime, rms: Math.sqrt(data.reduce((sum, sample) => sum + sample * sample, 0) / data.length) });
        }, 10);
      }
      if (entry?.analyser) connect.call(this, entry.analyser);
    }
    return result;
  };
});

function wav(seconds) {
  const samples = Math.round(24000 * seconds), bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(48000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 180 / 24000) * 5000), 44 + i * 2);
  return [...bytes];
}
const checks = [];
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
try {
  await page.reload();
  // Deliberately slower than tiny heading playback, so one-passage prefetch fails.
  await app.evaluate(({ ipcMain }, clips) => {
    ipcMain.removeHandler('reader:synthesize');
    globalThis.__bufferRequests = 0;
    ipcMain.handle('reader:synthesize', async (_event, request) => {
      globalThis.__bufferRequests++;
      await new Promise(resolve => setTimeout(resolve, 180));
      return { bytes: new Uint8Array(request.text.length < 20 ? clips.short : clips.long), mime: 'audio/wav', sampleRate: 24000 };
    });
  }, { short: wav(.16), long: wav(1.2) });
  await menuClick(page.getByLabel('Paste text', { exact: true }));
  await page.getByLabel('Document title', { exact: true }).fill('Continuous playback test');
  await page.getByLabel('Your text', { exact: true }).fill(Array.from({ length: 24 }, (_, i) => i % 2 === 0 ? `Heading ${i}` : `A short paragraph number ${i}, ready for continuous narration.`).join('\n\n'));
  await page.getByRole('button', { name: 'Add to my library' }).click();
  await check('Preprocessing settings persist', async () => {
    await menuClick(page.getByRole('button', { name: 'Settings', exact: true }));
    await page.getByLabel('Playback buffer').selectOption('8');
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-startup-v2')), '8');
    await page.getByLabel('Playback buffer').selectOption('0');
    await page.getByLabel('Close dialog', { exact: true }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem('cadence-startup-v2')), '0');
  });
  await check('Short paragraphs play continuously despite slow generation', async () => {
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor({ timeout: 30000 });
    await page.waitForFunction(() => window.__audioRuns.some(run => run.starts.length >= 12), { timeout: 30000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.passage')).at(-1)?.getAttribute('aria-current') === 'true', { timeout: 30000 });
    await page.mouse.move(8, 8);
    await page.getByLabel('Play narration', { exact: true }).waitFor();
    const run = await page.evaluate(() => { const run = window.__audioRuns.find(run => run.starts.length >= 12); return { starts: run.starts, samples: run.samples }; });
    await writeFile('test-results/continuous-audio-timing.json', JSON.stringify(run, null, 2));
    assert.equal(run.starts.length, 12);
    for (let i = 1; i < run.starts.length; i++) {
      const prior = run.starts[i - 1], current = run.starts[i];
      assert.ok(Math.abs(current.at - (prior.at + prior.duration / prior.rate)) < 1e-8, `Gap before passage ${i}: ${current.at - (prior.at + prior.duration / prior.rate)}s, prepared ${current.preparedAt}`);
      assert.ok(current.preparedAt < current.at, `Late preparation at passage ${i}`);
    }
    const first = run.starts[0], last = run.starts.at(-1);
    const audible = run.samples.filter(sample => sample.at > first.at + .3 && sample.at < last.at + last.duration - .1);
    assert.ok(audible.length > 100);
    assert.equal(audible.filter(sample => sample.rms < .01).length, 0, 'Unexpected silent blocks between paragraphs');
    await writeFile('test-results/continuous-audio-timing.json', JSON.stringify(run, null, 2));
  });
  await check('Pause freezes playback and resumes without model work', async () => {
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.waitForTimeout(150);
    await page.getByLabel('Pause narration', { exact: true }).click();
    const before = await page.evaluate(() => window.__activeAudioRun().context.currentTime);
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => window.__activeAudioRun().context.currentTime);
    assert.equal(after, before);
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.waitForTimeout(200);
    const resumed = await page.evaluate(() => window.__activeAudioRun().context.currentTime);
    assert.ok(resumed > after);
  });
  await check('Faster playback remains continuous and compensates voice pitch', async () => {
    await page.getByLabel('Narration speed').evaluate(element => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '1.5');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(1000);
    const run = await page.evaluate(() => ({ starts: window.__activeAudioRun().starts, samples: window.__activeAudioRun().samples }));
    const accelerated = run.starts.filter(start => start.rate === 1.5);
    assert.ok(accelerated.length > 2);
    for (let i = 1; i < accelerated.length; i++) {
      const previous = accelerated[i - 1];
      assert.ok(Math.abs(accelerated[i].at - previous.at - previous.duration / 1.5) < 1e-8);
    }
    // A 180 Hz input should remain near 180 Hz, rather than rising to 270 Hz.
    const frequency = await page.evaluate(() => {
      const run = window.__activeAudioRun(), analyser = run.analyser;
      analyser.fftSize = 4096;
      return new Promise(resolve => setTimeout(() => {
        const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
        let peak = 1; for (let i = 2; i < 100; i++) if (bins[i] > bins[peak]) peak = i;
        resolve(peak * run.context.sampleRate / analyser.fftSize);
      }, 250));
    });
    assert.ok(Math.abs(frequency - 180) < 20, `Pitch changed to ${frequency} Hz`);
  });
  await check('Document switch discards scheduled old speech', async () => {
    const index = await page.evaluate(() => window.__audioRuns.indexOf(window.__activeAudioRun()));
    await menuClick(page.locator('.recent-document').filter({ hasText: 'The art of paying attention' }));
    await page.getByRole('heading', { name: 'The art of paying attention' }).waitFor();
    const previous = await page.evaluate(index => ({ state: window.__audioRuns[index].context.state, time: window.__audioRuns[index].context.currentTime, starts: window.__audioRuns[index].starts }), index);
    assert.equal(previous.state, 'closed');
    assert.ok(previous.starts.every(start => start.stopped || start.at + start.duration / start.rate <= previous.time));
  });
  assert.deepEqual(errors, []);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/playback-results.json', JSON.stringify({ checks, errors, packaged }, null, 2));
} finally { await app.close(); }
