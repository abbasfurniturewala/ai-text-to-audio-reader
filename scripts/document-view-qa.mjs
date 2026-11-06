import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord, readerSpeechText, waitReaderSpeech } from './reader-qa-helpers.mjs';
import { fivePagePdf } from './pdf-fixture.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright'), JSZip = require('jszip');
const output = path.resolve('test-results/document-view'), staged = process.argv.includes('--staged');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await mkdir(output, { recursive: true });
const paragraphs = Array.from({ length: 16 }, (_, n) => `Paragraph ${n + 1} begins with carefully chosen words so the voice can follow a complete sentence. ` + 'The reader can browse another section while narration stays independent. '.repeat(3));
const text = 'Opening chapter\n\n' + paragraphs.slice(0, 8).join('\n\n') + '\n\nClosing chapter\n\n' + paragraphs.slice(8).join('\n\n');
await writeFile(path.join(output, 'Document text.txt'), text);
await writeFile(path.join(output, 'Document markdown.md'), text.replace('Opening chapter', '# Opening chapter').replace('Closing chapter', '# Closing chapter'));
await writeFile(path.join(output, 'Document PDF.pdf'), fivePagePdf());
const docx = new JSZip();
docx.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
docx.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
docx.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
docx.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
docx.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + ['Opening chapter', ...paragraphs.slice(0, 8), 'Closing chapter', ...paragraphs.slice(8)].map(line => `<w:p>${line.endsWith('chapter') ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : ''}<w:r><w:t>${line}</w:t></w:r></w:p>`).join('') + '</w:body></w:document>');
await writeFile(path.join(output, 'Document Word.docx'), await docx.generateAsync({ type: 'nodebuffer' }));
const epub = new JSZip();
epub.file('mimetype', 'application/epub+zip');
epub.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>');
epub.file('OPS/book.opf', '<package><metadata><title>Document EPUB</title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
epub.file('OPS/one.xhtml', '<html><body><h1 id="one">Opening chapter</h1>' + paragraphs.slice(0, 8).map(text => `<p>${text}</p>`).join('') + '</body></html>');
epub.file('OPS/two.xhtml', '<html><body><h1 id="two">Closing chapter</h1>' + paragraphs.slice(8).map(text => `<p>${text}</p>`).join('') + '</body></html>');
epub.file('OPS/nav.xhtml', '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml#one">Opening chapter</a></li><li><a href="two.xhtml#two">Closing chapter</a></li></ol></nav></body></html>');
await writeFile(path.join(output, 'Document EPUB.epub'), await epub.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
let app, page;
const checks = [], errors = [];
async function check(name, run) { await run(); checks.push(name); console.log('PASS ' + name); }
async function start() {
  app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1480, 960);
    globalThis.__documentRequests = [];
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async (_, request) => {
      globalThis.__documentRequests.push(request);
      return { samples: Float32Array.from({ length: 120000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 };
    });
  });
}
async function close() { if (!app) return; const closing = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closing; app = undefined; }
async function pause() { await page.mouse.move(15, 15); await page.getByLabel('Pause narration', { exact: true }).click(); }
async function styles(pdf = false) {
  return page.evaluate(pdf => {
    const name = pdf ? 'cadence-pdf-speech' : 'cadence-reading-speech', span = [...(CSS.highlights.get(name) || [])][0]?.startContainer.parentElement;
    if (!span) return;
    const style = getComputedStyle(span, `::highlight(${name})`);
    return { background: style.backgroundColor, decoration: style.textDecorationLine };
  }, pdf);
}
async function checkStyles(pdf = false) {
  await page.getByLabel('Speech cue', { exact: true }).selectOption('highlight');
  let style = await styles(pdf); assert.notEqual(style.background, 'rgba(0, 0, 0, 0)'); assert.equal(style.decoration, 'none');
  await page.getByLabel('Speech cue', { exact: true }).selectOption('underline');
  style = await styles(pdf); assert.equal(style.background, 'rgba(0, 0, 0, 0)'); assert.equal(style.decoration, 'underline');
  if (!pdf) assert.equal(await page.locator('.current-passage').evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
}
async function reflowable() {
  await page.getByRole('button', { name: 'Document view', exact: true }).click(); await page.locator('.document-paper').waitFor();
  assert.equal(await page.locator('.pdf-page').count(), 0);
  await clickReaderWord(page.locator('.passage:not(.passage-heading)').first());
  await page.getByLabel('Pause narration', { exact: true }).waitFor(); await pause();
  await waitReaderSpeech(page); await checkStyles();
  const words = await readerSpeechText(page);
  await page.getByRole('button', { name: 'Reading view', exact: true }).click(); assert.equal(await page.locator('.document-paper').count(), 0);
  assert.deepEqual(await readerSpeechText(page), words);
  await page.getByRole('button', { name: 'Document view', exact: true }).click(); await page.locator('.document-paper').waitFor();
  assert.deepEqual(await readerSpeechText(page), words);
}
try {
  await start();
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await check('Pasted text notes support both views, exact-word playback and exclusive speech cues', reflowable);
  for (const [filename, title] of [['Document text.txt', 'Document text'], ['Document markdown.md', 'Document markdown'], ['Document Word.docx', 'Document Word'], ['Document EPUB.epub', 'Document EPUB']]) {
    await check(`${filename} supports Document view, navigation, speech cues and reload restoration`, async () => {
      await page.locator('input[type=file]').setInputFiles(path.join(output, filename)); await page.getByRole('heading', { name: title, exact: true }).waitFor();
      await reflowable(); await page.getByLabel('Go to section', { exact: true }).fill('2'); await page.getByLabel('Go to section', { exact: true }).press('Enter');
      await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-2');
      const audio = await page.locator('.audio-navigation>span').innerText();
      // A renderer reload bypasses the desktop close/flush handshake. Wait for
      // the existing debounced summary save, rather than racing its 400ms timer.
      const deadline = Date.now() + 15000;
      while (!await page.evaluate(({ title, wanted }) => new Promise((resolve, reject) => {
        const open = indexedDB.open('keyval-store'); open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result, tx = db.transaction('keyval'), request = tx.objectStore('keyval').get('cadence-library-index-v2');
          request.onerror = () => reject(request.error); tx.oncomplete = () => db.close();
          request.onsuccess = () => resolve(request.result?.find(item => item.title === title)?.position === wanted);
        };
      }), { title, wanted: Number(audio.match(/\d+$/)[0]) - 1 })) { assert(Date.now() < deadline, 'The audio position was not saved'); await page.waitForTimeout(50); }
      await page.reload(); await page.getByRole('heading', { name: title, exact: true }).waitFor(); await page.locator('.document-paper').waitFor();
      await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-2');
      await page.waitForFunction(audio => document.querySelector('.audio-navigation>span')?.textContent.trim() === audio.trim(), audio);
      assert.equal(await page.locator('.audio-navigation>span').innerText(), audio);
      assert.equal(await page.getByLabel('Speech cue', { exact: true }).inputValue(), 'underline');
      assert.equal((await readerSpeechText(page)).length, 0);
    });
  }
  await check('EPUB book layout preserves chapters, independent browsing and exact-word suffixes', async () => {
    await page.getByLabel('Go to section', { exact: true }).fill('1'); await page.getByLabel('Go to section', { exact: true }).press('Enter');
    await clickReaderWord(page.locator('.passage').filter({ hasText: 'Paragraph 1 begins' }).first(), 'carefully');
    await page.getByLabel('Pause narration', { exact: true }).waitFor(); await pause();
    assert.ok((await app.evaluate(() => globalThis.__documentRequests)).some(request => request.text.startsWith('carefully chosen words')));
    const audio = await page.locator('.audio-navigation>span').innerText();
    await page.getByLabel('Go to section', { exact: true }).fill('2'); await page.getByLabel('Go to section', { exact: true }).press('Enter');
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-2');
    assert.equal(await page.locator('.audio-navigation>span').innerText(), audio);
    assert.equal(await page.getByRole('button', { name: 'Follow audio', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.screenshot({ path: path.join(output, staged ? 'staged-epub.png' : 'source-epub.png') });
  });
  await check('Full-screen EPUB supports both document modes and changes only one cue at a time', async () => {
    await page.getByLabel('Enter full screen', { exact: true }).click(); await page.locator('.app-shell.focus-mode').waitFor(); await page.waitForTimeout(350);
    const rail = page.locator('.focus-controls');
    await rail.getByLabel('Speech cue: underline; switch to highlight', { exact: true }).click();
    assert.equal(await page.locator('.app-shell').getAttribute('data-speech-cue'), 'highlight');
    await rail.getByLabel('Switch to reading view', { exact: true }).click(); assert.equal(await page.locator('.document-paper').count(), 0);
    await rail.getByLabel('Switch to document view', { exact: true }).click(); await page.locator('.document-paper').waitFor();
    await rail.getByLabel('Speech cue: highlight; switch to underline', { exact: true }).click();
    await page.keyboard.press('Escape'); await page.locator('.app-shell:not(.focus-mode)').waitFor(); await page.waitForTimeout(350);
    await page.getByLabel('Go to section', { exact: true }).fill('2'); await page.getByLabel('Go to section', { exact: true }).press('Enter');
  });
  await check('EPUB Document view, browsed section and underline preference survive a full process restart', async () => {
    await close(); await start(); await page.getByRole('heading', { name: 'Document EPUB', exact: true }).waitFor(); await page.locator('.document-paper').waitFor();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'section-2');
    assert.equal(await page.getByLabel('Speech cue', { exact: true }).inputValue(), 'underline');
    assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
    assert.equal((await readerSpeechText(page)).length, 0);
  });
  await check('PDF Document view retains original pages and applies exclusive native highlight or underline', async () => {
    await page.locator('input[type=file]').setInputFiles(path.join(output, 'Document PDF.pdf')); await page.getByRole('heading', { name: 'Document PDF', exact: true }).waitFor();
    await clickReaderWord(page.locator('.passage').first()); await page.getByLabel('Pause narration', { exact: true }).waitFor(); await pause();
    await page.getByRole('button', { name: 'Document view', exact: true }).click(); await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => CSS.highlights.get('cadence-pdf-speech')?.size > 0); await checkStyles(true);
    await page.screenshot({ path: path.join(output, staged ? 'staged-pdf-underline.png' : 'source-pdf-underline.png') });
    await page.getByLabel('Speech cue', { exact: true }).selectOption('highlight');
    await page.screenshot({ path: path.join(output, staged ? 'staged-pdf-highlight.png' : 'source-pdf-highlight.png') });
    assert.ok(await page.locator('.pdf-page-slot[data-current="true"] canvas').evaluate(canvas => canvas.width > 0));
  });
  await check('Compact document controls remain accessible without horizontal overflow', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
    const bounds = await page.locator('.view-switch, .speech-cue-control').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right }; }));
    assert.ok(bounds.every(box => box.left >= 0 && box.right <= 1024));
    assert.equal(await page.locator('.main-panel').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
    assert.deepEqual(errors, []);
  });
  await writeFile(path.join(output, staged ? 'staged-results.json' : 'source-results.json'), JSON.stringify({ checks, errors, staged, profile: env.CADENCE_DATA_DIR }, null, 2));
} catch (error) { if (page) await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
finally { await close(); }
