import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { navigationPdf } from './navigation-fixture.mjs';
import { menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const baseline = args.includes('--baseline'), staged = args.includes('--staged'), fixture = option('--fixture');
const tag = option('--tag') || (baseline ? 'baseline' : staged ? 'staged' : 'source');
const output = path.resolve('test-results/playback-performance'); await mkdir(output, { recursive: true });
const input = fixture ? path.resolve(fixture) : path.join(output, 'Playback fixture.pdf');
if (!fixture) await writeFile(input, navigationPdf({ count: 2043 }));
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, fixture ? 'real-book-profile' : 'synthetic-profile') };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
if (args.includes('--visible')) delete env.CADENCE_QA;
const executablePath = baseline ? path.resolve('release/win-unpacked/Cadence.exe') : staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron');
const app = await _electron.launch({ executablePath, args: baseline || staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow(), errors = [], reports = [];
page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name,item.value]));
try {
  await page.addInitScript(() => {
    window.__commits = 0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, inject: () => 1, onCommitFiberRoot: () => window.__commits++, onCommitFiberUnmount: () => {} };
  });
  await page.reload();
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480,960);
    const original = ipcMain._invokeHandlers.get('reader:synthesize'); globalThis.__requests = [];
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async (...args) => {
      const item = { characters: args[1].text.length, priority: args[1].priority, start: Date.now() }; globalThis.__requests.push(item);
      try { const audio = await original(...args); item.end = Date.now(); item.timing = audio.timing; item.seconds = audio.samples?.length / audio.sampleRate; return audio; }
      catch (error) { item.error = error.message; throw error; }
    });
  });
  const title = path.basename(input,'.pdf');
  await page.waitForFunction(() => !!document.querySelector('.reader-document-heading h1,.document-heading h1'));
  if (!(await page.getByRole('heading', { name: title, exact: true, level: 1 }).count())) {
    const recent = page.locator('.recent-document').filter({ hasText: title });
    if (await recent.count()) await menuClick(recent.first());
    else await page.locator('input[type=file]').setInputFiles(input);
    await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor({ timeout: 240000 });
  }
  for (const name of ['Hide voice panel','Hide library sidebar']) { const button = page.getByLabel(name, { exact: true }); if (await button.count()) await button.click(); }
  const view = page.getByRole('button', { name: args.includes('--reading') ? 'Reading view' : 'Document view', exact: true }); if (await view.getAttribute('class') !== 'active') await view.click();
  const voice = option('--voice') || 'am_fenrir', speed = Number(option('--speed') || 1);
  await page.evaluate(({ voice, speed }) => { localStorage.setItem('cadence-local-voice', voice); localStorage.setItem('cadence-speed', String(speed)); }, { voice, speed }); await page.reload();
  await page.getByRole('heading', { name: title, exact: true, level: 1 }).waitFor();
  const jump = page.getByLabel('Go to original page', { exact: true }); await jump.fill('37'); await jump.press('Enter');
  await page.locator(args.includes('--reading') ? '[data-location-key="page-37"][data-mounted="true"] .passage' : '[data-pdf-page="37"] .pdf-text-layer span').first().waitFor();
  await page.evaluate(() => {
    const create = AudioContext.prototype.createBufferSource; window.__audio = [];
    AudioContext.prototype.createBufferSource = function () {
      window.__context = this; const source = create.call(this), start = source.start.bind(source);
      source.start = (...args) => { window.__audio.push({ wall: performance.now(), clock: this.currentTime, at: args[0], duration: args[2], rate: source.playbackRate.value }); return start(...args); }; return source;
    };
    window.__probe = undefined;
    new PerformanceObserver(list => { if (window.__probe) for (const entry of list.getEntries()) window.__probe.tasks.push({ at: entry.startTime - window.__probe.start, duration: entry.duration }); }).observe({ type: 'longtask' });
  });
  for (const phase of (option('--phases')?.split(',') || (args.includes('--compare-animation') ? ['idle','playing','promoted','static','paused'] : ['idle','playing','paused']))) {
    if (phase === 'playing') {
      await page.mouse.move(15,15);
      if (args.includes('--reading')) await page.locator('[data-location-key="page-37"] .passage').first().click();
      else await page.getByRole('button', { name: 'Listen from this page', exact: true }).click();
      await page.getByLabel('Pause narration', { exact: true }).waitFor({ timeout: 120000 });
    } else if (phase === 'paused') { await page.mouse.move(16,16); await page.getByLabel('Pause narration', { exact: true }).click(); }
    else if (phase === 'promoted') await page.addStyleTag({ content: '.waveform.active i{will-change:transform}' });
    else if (phase === 'scoped') await page.evaluate(() => {
      for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule instanceof CSSStyleRule && rule.selectorText.includes('::highlight')) rule.selectorText = rule.selectorText.replaceAll('::highlight', '.pdf-text-layer ::highlight');
    });
    else if (phase === 'static') await page.addStyleTag({ content: '.waveform.active i{animation:none!important}' });
    await page.waitForTimeout(phase === 'idle' ? 3500 : 1000);
    const box = await page.locator('.reader-scroll').boundingBox(); await page.mouse.move(box.x + box.width / 2,box.y + box.height / 2);
    const before = await metrics();
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 2000 }); await cdp.send('Profiler.start');
    await page.evaluate(() => {
      const scroller = document.querySelector('.reader-scroll');
      const run = window.__probe = { start: performance.now(), audioStart: window.__context?.currentTime, commits: window.__commits, top: scroller.scrollTop, min: scroller.scrollTop, max: scroller.scrollTop, frames: [], tasks: [], delays: [], last: 0, frame: 0, timer: 0 };
      const tick = now => { if (window.__probe !== run) return; if (run.last) run.frames.push(now - run.last); run.last = now; run.min = Math.min(run.min, scroller.scrollTop); run.max = Math.max(run.max, scroller.scrollTop); run.frame = requestAnimationFrame(tick); }; run.frame = requestAnimationFrame(tick);
      const poll = () => { const at = performance.now(); run.timer = setTimeout(() => { run.delays.push(performance.now() - at - 50); poll(); },50); }; poll();
    });
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, i < 20 ? 150 : -150); await page.waitForTimeout(40); }
    await page.waitForTimeout(5000);
    const result = await page.evaluate(phase => {
      const run = window.__probe; window.__probe = undefined; cancelAnimationFrame(run.frame); clearTimeout(run.timer);
      const summarize = values => { const sorted = [...values].sort((a,b) => a - b), at = p => sorted[Math.min(sorted.length - 1,Math.floor(sorted.length * p))]; return { count: sorted.length, median: at(.5), p95: at(.95), max: sorted.at(-1), over34: sorted.filter(n=>n>34).length, over50: sorted.filter(n=>n>50).length }; };
      return { phase, duration: performance.now() - run.start, commits: window.__commits - run.commits, frames: summarize(run.frames), delays: summarize(run.delays), longTasks: run.tasks, scrollRange: run.max - run.min, scrollTop: document.querySelector('.reader-scroll').scrollTop, mounted: document.querySelectorAll('.pdf-page canvas').length, nodes: document.getElementsByTagName('*').length, audioStart: run.audioStart, audioClock: window.__context?.currentTime, progress: document.querySelector('[aria-label="Reading progress"]')?.value };
    },phase);
    const after = await metrics(); result.renderer = Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(name=>[name,(after[name]-before[name])*1000]));
    const profile = (await cdp.send('Profiler.stop')).profile; await writeFile(path.join(output,`${tag}-${phase}.cpuprofile`),JSON.stringify(profile));
    result.processes = await app.evaluate(({ app }) => app.getAppMetrics());
    const meter = page.locator('.now-playing-art canvas');
    if (await meter.count()) {
      const before = await meter.evaluate(canvas => canvas.toDataURL()); await page.waitForTimeout(250);
      result.meter = await meter.evaluate((canvas, before) => ({ animated: canvas.toDataURL() !== before, pixels: canvas.width * canvas.height, scale: canvas.width / canvas.clientWidth, deviceScale: devicePixelRatio }),before);
    }
    reports.push(result); console.log(JSON.stringify({ ...result, processes: undefined, longTasks: result.longTasks.length }));
  }
  const requests = await app.evaluate(() => globalThis.__requests), audio = await page.evaluate(() => window.__audio);
  assert.deepEqual(errors,[]);
  const gpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
  await writeFile(path.join(output,tag + '.json'),JSON.stringify({ tag, fixture: path.basename(input), profile: env.CADENCE_DATA_DIR, visible: args.includes('--visible'), voice, speed, gpu, reports, requests, audio, errors },null,2));
  await page.screenshot({ path: path.join(output,tag + '-reader.png') });
  if (args.includes('--assert')) {
    const playing = reports.find(report => report.phase === 'playing'), paused = reports.find(report => report.phase === 'paused');
    assert.ok(playing.commits / (playing.duration / 1000) < 12, 'Playback causes excessive UI commits');
    assert.ok(playing.scrollRange > 1500, 'The playback test did not scroll through the document');
    assert.ok(paused.audioClock - paused.audioStart < .025, 'Paused narration continued advancing');
    assert.ok(requests.some(request => request.timing?.generateMs > 0 && request.seconds > 0), 'The test must generate real offline speech');
    assert.ok(reports.every(report => report.mounted <= 8), 'PDF rendering exceeded its page bound');
    if (playing.meter) { assert.ok(playing.meter.animated, 'The playback meter stopped animating'); assert.equal(paused.meter.animated,false); assert.ok(Math.abs(playing.meter.scale - playing.meter.deviceScale) < .03); }
    assert.ok(audio.every((clip,index) => !index || Math.abs(clip.at - audio[index - 1].at - audio[index - 1].duration / audio[index - 1].rate) < .001), 'Prepared audio handoffs were not seamless');
  }
} catch(error) { await page.screenshot({ path: path.join(output,tag + '-failure.png') }); throw error; }
finally { await app.close(); }
