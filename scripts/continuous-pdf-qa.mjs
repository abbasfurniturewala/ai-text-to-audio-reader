import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord, menuClick } from './reader-qa-helpers.mjs';
import { navigationPdf } from './navigation-fixture.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const output = path.resolve('test-results/continuous-pdf'), staged = process.argv.includes('--staged');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'Continuous book.pdf'), navigationPdf({ count: 200 }));
function mixedPdf() {
  const dimensions = [[612,792],[792,612],[400,400],[306,792],[612,792]], objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'], pages = [];
  dimensions.forEach(([width,height], index) => {
    const id = objects.length + 1; pages.push(id);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const stream = index === 3 ? '' : `BT /F1 12 Tf 36 ${height - 70} Td (Page ${index + 1} keeps the original layout.) Tj ET`;
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'; objects[1] = `<< /Type /Pages /Kids [${pages.map(id => `${id} 0 R`).join(' ')}] /Count 5 >>`;
  let body = '%PDF-1.4\n'; const offsets = [];
  objects.forEach((object,index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  return body + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}
await writeFile(path.join(output, 'Mixed pages.pdf'), mixedPdf());
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
let app, page; const errors = [], checks = [];
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480,960); globalThis.__continuousRequests = [];
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async (_,request) => {
      globalThis.__continuousRequests.push(request);
      return { samples: Float32Array.from({ length: 36000 }, (_,i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
}
async function close() {
  if (!app) return; const closing = app.waitForEvent('close');
  try { await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(),50); }); } catch (error) { if (!/garbage collected|closed/.test(error.message)) throw error; }
  await closing; app = undefined;
}
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
const slot = number => page.locator(`[data-pdf-page="${number}"]`);
async function rendered(number) { await page.waitForFunction(number => { const canvas = document.querySelector(`[data-pdf-page="${number}"] canvas`); return canvas?.width > 0 && document.querySelector(`[data-pdf-page="${number}"] .pdf-loading`) === null; }, number); }
async function jump(number) { const input = page.getByLabel('Go to original page', { exact: true }); await input.fill(String(number)); await input.press('Enter'); await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`,number); await rendered(number); }
async function pause() { await page.mouse.move(20,20); const button = page.getByLabel('Pause narration', { exact: true }); if (await button.count()) await button.click(); }
async function clickWord(number, passage, word = 'complete') {
  const text = slot(number).locator('.pdf-text-layer span').filter({ hasText: `On page ${number} passage ${passage} ` }); await text.waitFor(); await text.scrollIntoViewIfNeeded();
  await text.evaluate(element => { const root = element.closest('.reader-scroll'); root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 200, behavior: 'instant' }); });
  await page.waitForFunction(element => { const box = element.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element; }, await text.elementHandle());
  const point = await text.evaluate((element,word) => { const at = element.textContent.indexOf(word), range = new Range(); range.setStart(element.firstChild,at); range.setEnd(element.firstChild,at + word.length); const box = range.getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }, word);
  await page.mouse.click(point.x,point.y); await page.getByLabel('Pause narration', { exact: true }).waitFor();
}
async function speechVisible() { return page.evaluate(() => { const range = [...(CSS.highlights.get('cadence-pdf-speech') || [])][0]; if (!range) return false; const box = range.getBoundingClientRect(), view = document.querySelector('.reader-scroll').getBoundingClientRect(); return box.top >= view.top && box.bottom <= view.bottom && box.left >= view.left && box.right <= view.right; }); }
try {
  await start(); await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.locator('input[type=file]').setInputFiles(path.join(output,'Continuous book.pdf')); await page.getByRole('heading', { name: 'Continuous book', exact: true, level: 1 }).waitFor();
  await page.getByRole('button', { name: 'Document view', exact: true }).click(); await rendered(1);
  await check('Original PDF pages form one vertical document with a bounded set of canvases', async () => {
    assert.equal(await page.locator('.pdf-page-slot').count(),200); assert.ok(await page.locator('.pdf-page canvas').count() <= 8);
    const separation = await page.evaluate(() => { const first = document.querySelector('[data-pdf-page="1"]').getBoundingClientRect(), next = document.querySelector('[data-pdf-page="2"]').getBoundingClientRect(); return next.top - first.bottom; });
    assert.ok(separation >= 20 && separation < 30); assert.equal(page.workers().length,1);
  });
  await check('Mouse-wheel browsing crosses PDF pages and updates the page indicator without moving audio', async () => {
    const box = await page.locator('.reader-scroll').boundingBox(); await page.mouse.move(box.x + box.width / 2,box.y + box.height / 2); await page.mouse.wheel(0,1700);
    await page.waitForFunction(() => Number(document.querySelector('.pdf-document').dataset.page) > 1);
    assert.ok((await page.locator('.audio-navigation>span').innerText()).includes('page 1'));
    assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'),'false');
  });
  await check('Exact-word starts and Space pause still work on a scrolled PDF page', async () => {
    await jump(7); await clickWord(7,5); await page.keyboard.press('Space'); await page.getByLabel('Play narration', { exact: true }).waitFor();
    const requests = await app.evaluate(() => globalThis.__continuousRequests); assert.ok(requests.some(request => request.text.startsWith('complete story')));
    assert.ok(await speechVisible());
  });
  await check('Go to audio reveals the paused spoken sentence without enabling Follow audio', async () => {
    await jump(40); await page.getByRole('button', { name: 'Go to audio', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-7'); await rendered(7); assert.equal(await speechVisible(),true);
    assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'),'false');
  });
  await check('Follow audio scrolls within the original page and continues across the next page boundary', async () => {
    await jump(3); await clickWord(3,12); await page.getByRole('button', { name: 'Follow audio', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4'); await rendered(4);
    assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'),'true'); assert.ok(await speechVisible()); await pause();
  });
  await check('Manual scrolling cancels following immediately and narration keeps its independent page', async () => {
    const audio = await page.locator('.audio-navigation>span').innerText(), box = await page.locator('.reader-scroll').boundingBox();
    await page.mouse.move(box.x + box.width / 2,box.y + box.height / 2); await page.mouse.wheel(0,1800); await page.waitForTimeout(250);
    assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'),'false'); assert.equal(await page.locator('.audio-navigation>span').innerText(),audio);
  });
  await check('Search and zoom target the right original page while preserving speech and word mappings', async () => {
    await page.getByLabel('Search document', { exact: true }).click(); await page.getByLabel('Search document text', { exact: true }).fill('On page 150 passage 6');
    await page.waitForFunction(() => [...(CSS.highlights.get('cadence-pdf-match') || [])].map(range => range.toString()).join('') === 'On page 150 passage 6');
    const width = await slot(150).locator('canvas').evaluate(canvas => canvas.clientWidth);
    await page.getByLabel('PDF zoom', { exact: true }).selectOption('1.5'); await rendered(150); assert.ok(await slot(150).locator('canvas').evaluate(canvas => canvas.clientWidth) > width * 1.4);
    await page.getByLabel('Close search', { exact: true }).click(); await page.getByLabel('PDF zoom', { exact: true }).selectOption('1'); await rendered(150);
    assert.ok((await page.locator('.audio-navigation>span').innerText()).includes('page 4'));
  });
  await check('Large jumps keep one PDF worker, at most eight painted pages and no detached highlight ranges', async () => {
    for (const number of [190,12,180,22]) { await jump(number); await page.waitForTimeout(80); assert.ok(await page.locator('.pdf-page canvas').count() <= 8); assert.equal(page.workers().length,1); }
    assert.equal(await page.evaluate(() => [...CSS.highlights.values()].every(highlight => [...highlight].every(range => range.startContainer.isConnected))),true);
  });
  await check('Full-screen PDF controls expose Follow audio and return to the same spoken sentence', async () => {
    await page.getByLabel('Enter full screen', { exact: true }).click(); await page.locator('.focus-controls').waitFor(); await page.waitForTimeout(350);
    const rail = page.locator('.focus-controls'); await rail.getByRole('button', { name: 'Follow audio', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.pdf-document')?.dataset.page === '4');
    await rendered(4); assert.equal(await speechVisible(),true); assert.equal(await rail.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'),'true');
    await rail.getByRole('button', { name: 'Follow audio', exact: true }).click(); await rail.getByLabel('Exit full screen', { exact: true }).click(); await page.locator('.app-shell:not(.focus-mode)').waitFor(); await page.waitForTimeout(350);
  });
  await check('A scrolled PDF page and an immediate explicit jump survive full process restarts with no autoplay', async () => {
    await page.locator('.player').waitFor({ state: 'hidden', timeout: 15000 });
    await jump(42); await slot(43).evaluate(element => { const scroller = element.closest('.reader-scroll'); scroller.scrollTo({ top: scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 24, behavior: 'instant' }); });
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-43'); await close(); await start();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-43'); await rendered(43); assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
    await jump(92); await close(); await start(); await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-92'); await rendered(92);
    assert.equal(await page.getByRole('button', { name: 'Document view', exact: true }).getAttribute('class'),'active'); assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
  });
  await check('Mixed page sizes and blank pages retain their original geometry and can be scrolled in either direction', async () => {
    await page.locator('input[type=file]').setInputFiles(path.join(output,'Mixed pages.pdf')); await page.getByRole('heading', { name: 'Mixed pages', exact: true, level: 1 }).waitFor(); await page.getByRole('button', { name: 'Document view', exact: true }).click(); await rendered(1);
    for (const [number,ratio] of [[2,792/612],[3,1],[4,306/792],[5,612/792],[2,792/612]]) { await jump(number); const size = await slot(number).boundingBox(); assert.ok(Math.abs(size.width / size.height - ratio) < .02); }
    const notification = page.getByLabel('Dismiss notification', { exact: true }); if (await notification.isVisible()) await notification.click();
    await page.mouse.move(19,19); await page.screenshot({ path: path.join(output, staged ? 'staged-continuous-pages.png' : 'source-continuous-pages.png') });
  });
  await check('Closing the document releases all canvases, PDF workers and registered highlight ranges', async () => {
    await page.getByLabel('Close document', { exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.pdf-page-slot')); await page.waitForTimeout(300);
    assert.equal(page.workers().length,0); assert.equal(await page.evaluate(() => [...CSS.highlights.keys()].filter(key => key.startsWith('cadence-pdf')).length),0); assert.deepEqual(errors,[]);
  });
  await check('Non-PDF Document view follows narration across sections and Go to audio returns without enabling follow', async () => {
    await menuClick(page.getByLabel('Paste text', { exact: true })); await page.getByLabel('Document title', { exact: true }).fill('Continuous text');
    await page.getByLabel('Your text', { exact: true }).fill(Array.from({ length: 45 }, (_,index) => `Paragraph ${index + 1}. A reader follows a complete story through the afternoon, taking time to enjoy the words and the quiet spaces between them. The next paragraph carries the story forward.`).join('\n\n'));
    await page.getByRole('button', { name: 'Add to my library' }).click(); await page.getByRole('heading', { name: 'Continuous text', exact: true }).waitFor(); await page.getByRole('button', { name: 'Document view', exact: true }).click();
    await clickReaderWord(page.locator('[data-location-key="section-1"] .passage').last()); await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Follow audio', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-2'); await pause();
    const jump = page.getByLabel('Go to section', { exact: true }); await jump.fill('3'); await jump.press('Enter'); await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-3');
    await page.getByRole('button', { name: 'Go to audio', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-2');
    assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'),'false'); assert.deepEqual(errors,[]);
  });
  await writeFile(path.join(output, staged ? 'staged-results.json' : 'source-results.json'),JSON.stringify({ checks, errors, staged, profile: env.CADENCE_DATA_DIR },null,2));
} catch (error) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output,'failure.png') }); console.log(await page.getByRole('alert').allTextContents()); console.log(await page.evaluate(() => ({ page: document.querySelector('.pdf-document')?.dataset.page, viewing: document.querySelector('.viewing-location')?.dataset.location, input: document.querySelector('[aria-label="Go to original page"]')?.value, top: document.querySelector('.reader-scroll')?.scrollTop, saved: localStorage.getItem('cadence-reader-session-v1') }))); } throw error; }
finally { await close(); }
