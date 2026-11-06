import { createRequire } from 'node:module';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { navigationPdf } from './navigation-fixture.mjs';
import { clickReaderWord } from './reader-qa-helpers.mjs';

const require = createRequire(import.meta.url), { _electron } = require('playwright');
const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const baseline = args.includes('--baseline'), staged = args.includes('--staged'), tag = option('--tag') || (baseline ? 'baseline' : staged ? 'staged' : 'source');
assert(/^[\w-]+$/.test(tag));
const output = path.resolve('test-results/startup-performance', tag), profile = path.join(output, 'profile');
await mkdir(output, { recursive: true });
const input = path.resolve(option('--fixture') || path.join(output, args.includes('--pdf') ? 'Startup PDF fixture.pdf' : 'Startup reading fixture.md'));
const pdf = path.extname(input).toLowerCase() === '.pdf', documentMode = args.includes('--document') || pdf && !args.includes('--reading');
const title = option('--title') || (args.includes('--seed') ? 'The Prince' : path.basename(input, path.extname(input)));
if (!option('--fixture') && !args.includes('--seed')) await writeFile(input, pdf ? navigationPdf({ count: 2043 }) : Array.from({ length: 68 }, (_, chapter) => `# Chapter ${chapter + 1}\n\n` + Array.from({ length: 8 }, (_, index) => `Passage ${chapter * 8 + index + 1} begins with carefully chosen words about a patient traveller. ` + 'The traveller follows the river through the valley and considers the changing landscape. '.repeat(3)).join('\n\n')).join('\n\n'));
// Copy only an isolated QA library; never use the normal Cadence profile.
if (args.includes('--seed')) {
  try { await access(profile); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await cp(path.resolve('test-results/startup-lag/profile'), profile, { recursive: true, force: false, errorOnExist: true }); }
}
const env = { ...process.env, CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: profile };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL; delete env.CADENCE_QA;
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const executablePath = baseline ? path.resolve('release/win-unpacked/Cadence.exe') : staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron');
const launch = () => _electron.launch({ executablePath, args: [...(baseline || staged ? [] : ['.']), ...(args.includes('--accessibility') ? ['--force-renderer-accessibility'] : [])], env, timeout: 60000 });
const close = async app => {
  const process = app.process();
  if (process.exitCode !== null) { assert.equal(process.exitCode, 0, 'Test process exited unexpectedly'); return; }
  const closing = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(error => { if (!/closed|garbage collected/.test(error.message)) throw error; });
  try { await closing; } catch (error) { if (process.exitCode !== 0) throw error; }
};
const clickPdfWord = async (page, word) => {
  const point = await word.evaluate(element => { const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode(); const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, Math.min(2, node.textContent.length)); const box = range.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
  await page.mouse.click(point.x, point.y);
};
const afterJumpScroll = async page => {
  await page.evaluate(() => {
    const root = document.querySelector('.reader-scroll'), run = window.__afterJump = { frames: [], moving: [], tasks: [], last: 0, top: root.scrollTop };
    const tick = now => { const top = root.scrollTop; if (run.last) { run.frames.push(now - run.last); if (Math.abs(top - run.top) > .5) run.moving.push(now - run.last); } run.last = now; run.top = top; run.frame = requestAnimationFrame(tick); }; run.frame = requestAnimationFrame(tick);
    run.observer = new PerformanceObserver(list => run.tasks.push(...list.getEntries().map(entry => entry.duration))); run.observer.observe({ type: 'longtask' });
  });
  const root = page.locator('.reader-scroll'), box = await root.boundingBox(); await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5);
  const moves = [];
  for (let index = 0; index < 10; index++) {
    const target = await root.evaluate((root, delta) => { root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: Math.sign(delta) })); const top = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + delta)); root.scrollTo({ top, behavior: 'smooth' }); return top; }, index % 2 ? -3000 : 3000);
    await page.waitForTimeout(3000); moves.push({ target, actual: await root.evaluate(root => root.scrollTop) });
  }
  const result = await page.evaluate(() => { const run = window.__afterJump; cancelAnimationFrame(run.frame); run.observer.disconnect(); const summarize = values => ({ count: values.length, max: Math.max(0, ...values), over50: values.filter(value => value > 50).length }); return { seconds: 30, frames: summarize(run.frames), movingFrames: summarize(run.moving), tasks: run.tasks, playing: document.querySelector('.play-button')?.getAttribute('aria-label') === 'Pause narration' }; });
  return { ...result, moves };
};
{
  const app = await launch(), page = await app.firstWindow();
  try {
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1480, 960); win.webContents.setAudioMuted(true); });
    if (args.includes('--seed')) await page.getByRole('heading', { name: title, exact: true }).waitFor();
    else {
      await page.waitForFunction(() => !!document.querySelector('h1'));
      if (!await page.getByRole('heading', { name: title, exact: true }).count()) await page.locator('input[type=file]').setInputFiles(input);
      await page.getByRole('heading', { name: title, exact: true }).waitFor();
    }
    await page.evaluate(() => { localStorage.setItem('cadence-local-voice', 'am_fenrir'); localStorage.setItem('cadence-speed', '1'); });
    await page.reload(); await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const hide = page.getByLabel('Hide voice panel', { exact: true }); if (await hide.count()) await hide.click();
    await page.getByRole('button', { name: documentMode ? 'Document view' : 'Reading view', exact: true }).click();
    const section = page.getByLabel(pdf ? 'Go to original page' : 'Go to section', { exact: true }); await section.fill(pdf ? '37' : '18'); await section.press('Enter');
    if (pdf && documentMode) { await page.locator('[data-pdf-page="37"] .pdf-text-layer span').first().waitFor(); await page.getByRole('button', { name: 'Listen from this page', exact: true }).click(); }
    else {
      const start = args.includes('--seed') ? page.locator('[data-passage-index="120"]') : page.locator(`[data-location-key="${pdf ? 'page-37' : 'section-18'}"] .passage:not(.passage-heading)`).first();
      await clickReaderWord(start);
    }
    await page.getByLabel('Pause narration', { exact: true }).waitFor({ state: 'attached', timeout: 120000 }); await page.mouse.move(15, 15); await page.getByLabel('Pause narration', { exact: true }).click();
    if (pdf) {
      await section.fill('37'); await section.press('Enter');
      await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-37');
      await page.locator('[data-pdf-page="37"] .pdf-text-layer span').first().waitFor(); await page.waitForTimeout(100);
    }
  } catch (error) { await page.screenshot({ path: path.join(output, 'seed-failure.png') }); console.log(await page.locator('body').innerText().then(text => text.slice(-500))); throw error; }
  finally { await close(app); }
}
const launched = Date.now(), app = await launch(), page = await app.firstWindow(), errors = [];
page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
try {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1480, 960); win.webContents.setAudioMuted(true);
    const original = ipcMain._invokeHandlers.get('reader:synthesize'); globalThis.__requests = [];
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async (...args) => {
      const row = { start: Date.now(), priority: args[1].priority, characters: args[1].text.length }; globalThis.__requests.push(row);
      try { const speech = await original(...args); row.end = Date.now(); row.timing = speech.timing; return speech; }
      catch (error) { row.end = Date.now(); row.error = error.message; throw error; }
    });
  });
  await page.getByRole('heading', { name: title, exact: true }).waitFor();
  await page.waitForFunction(key => document.querySelector('.viewing-location')?.dataset.location === key, pdf ? 'page-37' : 'section-18');
  await page.locator(pdf && documentMode ? '[data-pdf-page="37"] .pdf-text-layer span' : `[data-location-key="${pdf ? 'page-37' : 'section-18'}"] .passage`).first().waitFor();
  const readyMs = Date.now() - launched;
  const runtime = await app.evaluate(({ app }) => ({ electron: process.versions.electron, accessibility: app.accessibilitySupportEnabled }));
  if (args.includes('--no-accessibility')) await app.evaluate(({ app }) => app.setAccessibilitySupportEnabled(false));
  if (args.includes('--paragraph-accessibility')) await page.locator('.reader-scroll').evaluate(root => {
    const done = new WeakSet();
    const mark = element => { if (done.has(element)) return; done.add(element); element.setAttribute('aria-label', `Read from passage ${Number(element.dataset.passageIndex) + 1}: ${element.textContent}`); for (const child of element.children) child.setAttribute('aria-hidden', 'true'); };
    root.querySelectorAll('.passage').forEach(mark);
    new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) { const passage = node.closest('.passage'); if (passage) { mark(passage); if (node !== passage) node.setAttribute('aria-hidden', 'true'); } node.querySelectorAll('.passage').forEach(mark); } }).observe(root, { childList: true, subtree: true });
  });
  if (args.includes('--flat-reader')) {
    await page.addStyleTag({ content: '.passage[data-flat-text]{font-size:0!important}.passage[data-flat-text]>*{display:none!important}.passage[data-flat-text]::after{content:attr(data-flat-text);font-size:var(--flat-size);line-height:var(--flat-height)}' });
    await page.locator('.reader-scroll').evaluate(root => {
      const flatten = element => { if (element.dataset.flatText !== undefined) return; const style = getComputedStyle(element); element.style.setProperty('--flat-size', style.fontSize); element.style.setProperty('--flat-height', style.lineHeight); element.dataset.flatText = element.textContent; };
      root.querySelectorAll('.passage').forEach(flatten);
      new MutationObserver(records => { for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) { if (node.matches('.passage')) flatten(node); node.querySelectorAll('.passage').forEach(flatten); } }).observe(root, { childList: true, subtree: true });
    });
  }
  if (args.includes('--paint-containment')) await page.addStyleTag({ content: '.passage{contain:layout paint;overflow-clip-margin:50px}' });
  if (args.includes('--no-passage-filter')) await page.addStyleTag({ content: '.passage:hover:enabled{filter:none}' });
  if (args.includes('--no-word-hover')) await page.addStyleTag({ content: '.read-word:hover:not(.spoken-text){background:transparent;box-shadow:none}' });
  if (args.includes('--scroll-hover')) {
    await page.addStyleTag({ content: '.reader-scroll.qa-scrolling .read-word:hover:not(.spoken-text){background:transparent;box-shadow:none}.reader-scroll.qa-scrolling .passage:hover:enabled{filter:none}.reader-scroll.qa-scrolling .passage:hover:not(.current-passage){background:transparent}.reader-scroll.qa-scrolling .passage{transition:none}' });
    await page.locator('.reader-scroll').evaluate(root => { let timer; root.addEventListener('scroll', () => { root.classList.add('qa-scrolling'); clearTimeout(timer); timer = setTimeout(() => root.classList.remove('qa-scrolling'), 150); }, { passive: true }); });
  }
  if (args.includes('--static-meter')) await page.evaluate(() => {
    for (const method of ['clearRect', 'fill', 'stroke', 'fillRect']) { const original = CanvasRenderingContext2D.prototype[method]; CanvasRenderingContext2D.prototype[method] = function (...args) { if (this.canvas.width <= 200 && this.canvas.height <= 100) return; return original.apply(this, args); }; }
  });
  const cdp = await page.context().newCDPSession(page);
  if (args.includes('--timeline')) await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing', transferMode: 'ReturnAsStream' });
  if (args.includes('--cpu')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
  await page.evaluate(() => {
    const create = AudioContext.prototype.createBufferSource; window.__starts = [];
    AudioContext.prototype.createBufferSource = function () { window.__context = this; const node = create.call(this), start = node.start.bind(node); node.start = (...args) => { window.__starts.push({ at: performance.now(), wall: Date.now(), clock: this.currentTime, start: args[0], duration: args[2] }); return start(...args); }; return node; };
    const root = document.querySelector('.reader-scroll');
    const run = window.__run = { start: performance.now(), frames: [], moving: [], scroll: [], moves: [], tasks: [], states: [], last: 0, lastTop: root.scrollTop };
    const tick = now => { const top = root.scrollTop; if (run.last) { run.frames.push([now - run.start, now - run.last]); if (Math.abs(top - run.lastTop) > .5) run.moving.push(now - run.last); } run.scroll.push([now - run.start, top]); run.lastTop = top; run.last = now; run.frame = requestAnimationFrame(tick); }; run.frame = requestAnimationFrame(tick);
    run.observer = new PerformanceObserver(list => { for (const entry of list.getEntries()) run.tasks.push([entry.startTime - run.start, entry.duration]); }); run.observer.observe({ type: 'longtask' });
    run.timer = setInterval(() => run.states.push([performance.now() - run.start, document.querySelector('.play-button')?.getAttribute('aria-label'), Number(document.querySelector('.player')?.dataset.bufferedSeconds)]), 250);
    document.querySelector('.play-button').addEventListener('click', () => { run.clicked = run.start = performance.now(); run.clickedWall = Date.now(); performance.mark('cadence-qa-play'); run.frames = []; run.moving = []; run.scroll = []; run.tasks = []; run.states = []; run.last = 0; }, { capture: true, once: true });
  });
  await page.locator('.play-button').click();
  const box = await page.locator('.reader-scroll').boundingBox(); if (args.includes('--outside-pointer')) await page.mouse.move(15, 15); else await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5);
  const began = Date.now(), seconds = Number(option('--seconds') || 65);
  for (let bucket = 0, nextMove = 0, move = 0; Date.now() - began < seconds * 1000;) {
    if (args.includes('--smooth')) {
      if (Date.now() - began >= nextMove) {
        await page.locator('.reader-scroll').evaluate((root, delta) => { root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: Math.sign(delta) })); const run = window.__run, from = root.scrollTop, to = Math.max(0, Math.min(root.scrollHeight - root.clientHeight, from + delta)); run.moves.push({ at: performance.now() - run.start, from, to }); root.scrollTo({ top: to, behavior: 'smooth' }); }, move++ % 2 ? -3000 : 3000);
        nextMove += 3000;
      }
      await page.waitForTimeout(100);
    } else { await page.mouse.wheel(0, Math.floor((Date.now() - began) / 10000) % 2 ? -90 : 90); await page.waitForTimeout(200); }
    if (Date.now() - began >= (bucket + 1) * 30000) { bucket++; console.log(`${tag}: ${bucket * 30}s measured`); }
  }
  if (args.includes('--cpu')) { const { profile: cpu } = await cdp.send('Profiler.stop'); await writeFile(path.join(output, 'renderer.cpuprofile'), JSON.stringify(cpu)); }
  if (args.includes('--timeline')) {
    const completed = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve)); await cdp.send('Tracing.end');
    const { stream } = await completed; let data = '';
    for (;;) { const chunk = await cdp.send('IO.read', { handle: stream }); data += chunk.data; if (chunk.eof) break; }
    await cdp.send('IO.close', { handle: stream }); await writeFile(path.join(output, 'timeline.json'), data);
  }
  const trace = await page.evaluate(() => { const run = window.__run; cancelAnimationFrame(run.frame); clearInterval(run.timer); run.observer.disconnect(); const { observer, ...result } = run; return { ...result, starts: window.__starts }; });
  const jumps = [];
  if (args.includes('--jumps')) {
    const section = page.getByLabel(pdf ? 'Go to original page' : 'Go to section', { exact: true }); await section.fill(pdf ? '500' : '30'); await section.press('Enter');
    const word = pdf && documentMode ? page.locator('[data-pdf-page="500"] .pdf-text-layer span').first() : page.locator(`[data-location-key="${pdf ? 'page-500' : 'section-30'}"] .passage:not(.passage-heading)`).first(); await word.waitFor();
    for (const name of ['uncached', 'cached']) {
      await word.evaluate(element => element.addEventListener('click', () => { window.__click = performance.now(); window.__wall = Date.now(); }, { capture: true, once: true }));
      if (pdf && documentMode) await clickPdfWord(page, word); else await clickReaderWord(word, 4); await page.waitForFunction(() => window.__starts.some(row => row.at >= window.__click), {}, { timeout: 120000 });
      jumps.push(await page.evaluate(name => { const clip = window.__starts.find(row => row.at >= window.__click); return { name, click: window.__wall, scheduledMs: clip.at - window.__click }; }, name));
      if (name === 'uncached' && args.includes('--smooth')) jumps.at(-1).scroll = await afterJumpScroll(page);
      await page.waitForTimeout(300);
    }
  }
  const requests = await app.evaluate(() => globalThis.__requests);
  const summarize = values => { const sorted = [...values].sort((a, b) => a - b); return { count: sorted.length, p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1), over50: sorted.filter(value => value > 50).length }; };
  const buckets = Array.from({ length: Math.ceil(seconds / 30) }, (_, index) => ({ from: index * 30, frames: summarize(trace.frames.filter(row => row[0] >= index * 30000 && row[0] < (index + 1) * 30000).map(row => row[1])), tasks: trace.tasks.filter(row => row[0] >= index * 30000 && row[0] < (index + 1) * 30000), state: trace.states.filter(row => row[0] < (index + 1) * 30000).at(-1) }));
  const moves = trace.moves.map((move, index) => { const end = trace.moves[index + 1]?.at ?? trace.scroll.at(-1)[0], sample = trace.scroll.filter(row => row[0] >= move.at && row[0] < end).at(-1); return { ...move, duration: end - move.at, error: sample ? sample[1] - move.to : undefined }; });
  const maxScheduleGapMs = Math.max(0, ...trace.starts.slice(1).map((clip, index) => (clip.start - trace.starts[index].start - trace.starts[index].duration) * 1000));
  runtime.endingAccessibility = await app.evaluate(({ app }) => app.accessibilitySupportEnabled);
  const report = { tag, profile, title, mode: documentMode ? 'Document' : 'Reading', runtime, paragraphAccessibility: args.includes('--paragraph-accessibility'), flatReader: args.includes('--flat-reader'), noAccessibility: args.includes('--no-accessibility'), paintContainment: args.includes('--paint-containment'), noPassageFilter: args.includes('--no-passage-filter'), noWordHover: args.includes('--no-word-hover'), scrollHover: args.includes('--scroll-hover'), staticMeter: args.includes('--static-meter'), outsidePointer: args.includes('--outside-pointer'), readyMs, launchToClickMs: trace.clickedWall - launched, launchToFirstScheduledMs: trace.starts[0]?.wall - launched, firstScheduledMs: trace.starts[0]?.at - trace.clicked, frames: summarize(trace.frames.map(row => row[1])), movingFrames: summarize(trace.moving), moves, tasks: trace.tasks, buckets, jumps, maxScheduleGapMs, requests, errors };
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); await writeFile(path.join(output, 'trace.json'), JSON.stringify(trace));
  console.log(JSON.stringify({ ...report, buckets: undefined, moves: { count: moves.length, maxError: Math.max(0, ...moves.filter(move => move.duration > 1500).map(move => Math.abs(move.error))) }, tasks: trace.tasks.length, requests: requests.length })); assert.equal(errors.length, 0); assert(trace.starts.length > 0);
  await page.mouse.move(15, 15); const pause = page.getByLabel('Pause narration', { exact: true }); if (await pause.count()) await pause.click();
} catch (error) {
  console.log('Startup state', await page.evaluate(() => ({ location: document.querySelector('.viewing-location')?.dataset.location, original: document.querySelector('.pdf-document')?.dataset.page, saved: localStorage.getItem('cadence-reader-session-v1') })).catch(() => 'Process exited'));
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error;
} finally { await close(app); }
