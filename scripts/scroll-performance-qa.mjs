import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { navigationPdf } from './navigation-fixture.mjs';
import { menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const baseline = args.includes('--baseline'), staged = args.includes('--staged'), fixture = option('--fixture');
const tag = option('--tag') || (baseline ? 'baseline' : staged ? 'staged' : 'source'), output = path.resolve('test-results/scroll-performance');
await mkdir(output, { recursive: true });
const input = fixture ? path.resolve(fixture) : path.join(output,'Scroll fixture.pdf');
if (!fixture) await writeFile(input, navigationPdf({ count: 2043 }));
const version = JSON.parse(await readFile('package.json','utf8')).version;
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, fixture ? 'real-book-profile' : 'synthetic-profile') };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
const executablePath = baseline ? path.resolve('release/win-unpacked/Cadence.exe') : staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron');
const app = await _electron.launch({ executablePath, args: baseline || staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow(), errors = [], reports = [];
page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
try {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1920,1080);
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async () => ({ samples: Float32Array.from({ length: 48000 }, (_,index) => .1 * Math.sin(index * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }));
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
  const view = page.getByRole('button', { name: 'Document view', exact: true }); if (await view.getAttribute('class') !== 'active') await view.click();
  const jump = page.getByLabel('Go to original page', { exact: true }); await jump.fill('31'); await jump.press('Enter');
  await page.locator('[data-pdf-page="31"] .pdf-text-layer span').first().waitFor(); await page.waitForTimeout(1500);
  await page.evaluate(skip => {
    window.__scrollProfile = undefined;
    const native = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = function (...args) {
      const run = window.__scrollProfile;
      if (run && this.matches('.reader-scroll')) {
        const request = typeof args[0] === 'object' ? args[0] : { left: args[0], top: args[1] };
        const delta = Math.abs((request.top ?? this.scrollTop) - this.scrollTop) + Math.abs((request.left ?? this.scrollLeft) - this.scrollLeft);
        run.calls.push({ at: performance.now() - run.start, delta, behavior: request.behavior });
        if (skip && delta < .5) return;
      }
      return native.apply(this,args);
    };
    new PerformanceObserver(list => { if (window.__scrollProfile) for (const entry of list.getEntries()) window.__scrollProfile.tasks.push({ at: entry.startTime - window.__scrollProfile.start, duration: entry.duration }); }).observe({ type: 'longtask' });
  }, args.includes('--skip-noops'));
  for (const [name, direction, playing] of (args.includes('--smooth-only') ? [['smooth',1,false]] : [['forward',1,false],['reverse',-1,false],['playing',1,true]])) {
    if (playing) { await page.mouse.move(15,15); await page.getByLabel('Play narration', { exact: true }).click(); await page.getByLabel('Pause narration', { exact: true }).waitFor(); }
    const box = await page.locator('.reader-scroll').boundingBox(); await page.mouse.move(box.x + box.width / 2,box.y + box.height / 2);
    await page.evaluate(() => {
      const scroller = document.querySelector('.reader-scroll');
      const run = { start: performance.now(), top: scroller.scrollTop, calls: [], tasks: [], frames: [], samples: [], last: 0, frame: 0 }; window.__scrollProfile = run;
      const tick = now => { if (window.__scrollProfile !== run) return; if (run.last) run.frames.push(now - run.last); run.last = now; run.samples.push([now - run.start,scroller.scrollTop]); run.frame = requestAnimationFrame(tick); };
      run.frame = requestAnimationFrame(tick);
    });
    if (name === 'smooth') { await page.locator('.reader-scroll').evaluate(element => element.scrollBy({ top: 10000, behavior: 'smooth' })); await page.waitForTimeout(2200); }
    else for (let i = 0; i < 100; i++) { await page.mouse.wheel(0,100 * direction); await page.waitForTimeout(16); }
    await page.waitForTimeout(400);
    const result = await page.evaluate(name => {
      const run = window.__scrollProfile; cancelAnimationFrame(run.frame); window.__scrollProfile = undefined;
      const sorted = [...run.frames].sort((a,b) => a - b), quantile = p => sorted[Math.min(sorted.length - 1,Math.floor(sorted.length * p))];
      return { name, duration: performance.now() - run.start, distance: document.querySelector('.reader-scroll').scrollTop - run.top, frames: run.frames.length, median: quantile(.5), p95: quantile(.95), max: sorted.at(-1), over34: sorted.filter(n => n > 34).length, over50: sorted.filter(n => n > 50).length, scrollCalls: run.calls, longTasks: run.tasks, samples: run.samples, mounted: document.querySelectorAll('.pdf-page canvas').length, nodes: document.getElementsByTagName('*').length };
    },name);
    if (name !== 'smooth') assert.ok(Math.abs(result.distance) > 3000); assert.ok(result.mounted <= 8); reports.push(result);
    console.log(JSON.stringify({ ...result, samples: undefined, scrollCalls: result.scrollCalls.length, noops: result.scrollCalls.filter(call => call.delta < .5).length, longTasks: result.longTasks.length }));
    if (playing) { await page.mouse.move(16,16); await page.getByLabel('Pause narration', { exact: true }).click(); }
  }
  assert.deepEqual(errors,[]); await writeFile(path.join(output,tag + '.json'),JSON.stringify({ tag, fixture: path.basename(input), profile: env.CADENCE_DATA_DIR, reports, errors },null,2));
  if (args.includes('--assert')) for (const report of reports) { assert.ok(report.scrollCalls.every(call => call.delta >= .5), 'Redundant scroll correction interrupted native movement'); if (report.name === 'smooth') assert.ok(Math.abs(report.distance - 10000) <= 2, `Native scrolling stopped after ${report.distance}px`); }
} catch (error) { await page.screenshot({ path: path.join(output,tag + '-failure.png') }); throw error; }
finally { await app.close(); }
