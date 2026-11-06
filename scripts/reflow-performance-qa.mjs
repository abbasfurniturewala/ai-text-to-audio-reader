import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readerWordPoint, readerSpeechText } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const staged = process.argv.includes('--staged'), output = path.resolve('test-results/reflow-performance');
await mkdir(output, { recursive: true });
const paragraph = index => `Paragraph ${index} starts with carefully chosen words about a patient traveller. ` + 'The traveller follows the river through the quiet valley, taking time to notice the changing landscape. '.repeat(12);
const text = '# Opening chapter\n\n' + Array.from({ length: 100 }, (_, index) => paragraph(index)).join('\n\n') + '\n\n# Closing chapter\n\n' + Array.from({ length: 100 }, (_, index) => paragraph(index + 100)).join('\n\n');
const input = path.join(output, 'Long chapters.md'); await writeFile(input, text);
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow(), checks = [], errors = []; page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
const check = async (name, run) => { await run(); checks.push(name); console.log('PASS ' + name); };
try {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480, 960); globalThis.__requests = [];
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__requests.push(request);
      return { samples: new Float32Array(240000).fill(.1), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.locator('input[type=file]').setInputFiles(input); await page.getByRole('heading', { name: 'Long chapters', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Document view', exact: true }).click();
  await page.locator('[data-reader-text]').first().waitFor(); await page.waitForTimeout(350);
  await check('Long chapters retain accessible native text and landmarks with bounded markup', async () => {
    assert.equal(await page.locator('[data-location-key="section-1"] .passage').count(), 101);
    const count = await page.locator('[data-reader-text]').count(); assert(count > 0 && count < 20, `Mounted ${count} decorated text runs`);
    assert.equal(await page.locator('.read-word').count(), 0);
    assert((await page.locator('.reader-scroll *').count()) < 1500);
    const far = page.locator('[data-passage-index="80"]');
    assert.equal(await far.getAttribute('data-text-mounted'), 'false'); assert((await far.textContent()).includes('Paragraph 79 starts'));
  });
  let beforeHeight, afterHeight, clicked;
  await check('A fast click on not-yet-decorated text starts at its exact word', async () => {
    clicked = await page.locator('[data-passage-index="80"]').evaluate(element => {
      const beforeHeight = element.getBoundingClientRect().height, root = element.closest('.reader-scroll'); root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 120, behavior: 'instant' });
      const node = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE), at = node.textContent.indexOf('carefully');
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + 9); const box = range.getBoundingClientRect();
      const caret = document.caretRangeFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
      return { beforeHeight, at, text: node.textContent.slice(at), box: box.toJSON(), caret: caret && { inside: element.contains(caret.startContainer), offset: caret.startOffset, text: caret.startContainer.textContent.slice(0, 40) } };
    });
    await page.waitForFunction(() => document.querySelector('[data-passage-index="80"]')?.getAttribute('aria-current') === 'true');
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    const requests = await app.evaluate(() => globalThis.__requests);
    assert(requests.some(request => request.priority === 'interactive' && request.text.startsWith('carefully chosen words')), JSON.stringify({ clicked, requests: requests.map(request => [request.priority, request.text.slice(0, 80)]) }));
    beforeHeight = clicked.beforeHeight; afterHeight = await page.locator('[data-passage-index="80"]').evaluate(element => element.getBoundingClientRect().height);
    assert(Math.abs(afterHeight - beforeHeight) < 1, `Paragraph height changed ${beforeHeight} → ${afterHeight}`);
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
  });
  await check('Independent browsing keeps distant audio decorated without mounting the chapter', async () => {
    await page.locator('[data-passage-index="90"]').evaluate(element => { const root = element.closest('.reader-scroll'); root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 120, behavior: 'instant' }); }); await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-passage-index="80"]').getAttribute('aria-current'), 'true');
    assert.equal(await page.locator('[data-passage-index="80"]').getAttribute('data-text-mounted'), 'true');
    assert((await page.locator('[data-reader-text]').count()) < 20);
    await page.getByRole('button', { name: 'Go to audio', exact: true }).click();
    await page.waitForFunction(() => { const element = document.querySelector('[data-passage-index="80"]'), root = document.querySelector('.reader-scroll'); const a = element.getBoundingClientRect(), b = root.getBoundingClientRect(); return a.top >= b.top && a.top < b.bottom; });
  });
  await check('Paused speech ranges retain source offsets across view changes', async () => {
    await page.mouse.move(15, 15); await page.getByLabel('Pause narration', { exact: true }).click();
    const words = await readerSpeechText(page);
    assert(words.join('').startsWith('carefully chosen words'));
    await page.getByRole('button', { name: 'Reading view', exact: true }).click();
    assert.deepEqual(await readerSpeechText(page), words);
    assert.equal((await readerWordPoint(page.locator('[data-passage-index="80"]'), 'carefully')).start, clicked.at);
    assert.deepEqual(errors, []);
  });
  await check('Scrolling away preserves selected words until the selection is cleared', async () => {
    await page.locator('[data-passage-index="90"]').evaluate(element => { const root = element.closest('.reader-scroll'); root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 120, behavior: 'instant' }); });
    await page.locator('[data-passage-index="90"] [data-reader-text]').waitFor();
    const point = await readerWordPoint(page.locator('[data-passage-index="90"]'), 5);
    const selected = await page.locator('[data-passage-index="90"] [data-reader-text]').evaluate((element, point) => { const range = document.createRange(); range.setStart(element.firstChild, point.start); range.setEnd(element.firstChild, point.end); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); }, point);
    await page.locator('[data-passage-index="80"]').evaluate(element => { const root = element.closest('.reader-scroll'); root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 120, behavior: 'instant' }); });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => getSelection().toString()), selected);
    assert.equal(await page.locator('[data-passage-index="90"]').getAttribute('data-text-mounted'), 'true');
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.waitForFunction(() => document.querySelector('[data-passage-index="90"]')?.dataset.textMounted === 'false');
  });
  await check('Go to audio overrides an ongoing smooth browse and remains at its target', async () => {
    await page.locator('[data-passage-index="90"]').evaluate(element => { const root = element.closest('.reader-scroll'); root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 })); root.scrollTo({ top: root.scrollTop + element.getBoundingClientRect().top - root.getBoundingClientRect().top - 120, behavior: 'smooth' }); });
    await page.waitForTimeout(100); await page.getByRole('button', { name: 'Go to audio', exact: true }).click();
    await page.waitForTimeout(250);
    const position = await page.locator('[data-passage-index="80"]').evaluate(element => { const root = element.closest('.reader-scroll'), a = element.getBoundingClientRect(), b = root.getBoundingClientRect(); return { top: a.top - b.top, height: b.height }; });
    assert(position.top >= 0 && position.top < position.height, JSON.stringify(position));
  });
  await page.screenshot({ path: path.join(output, staged ? 'staged.png' : 'source.png') });
  await writeFile(path.join(output, staged ? 'staged.json' : 'source.json'), JSON.stringify({ checks, errors, beforeHeight, afterHeight }, null, 2));
} catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
finally { await app.close(); }
