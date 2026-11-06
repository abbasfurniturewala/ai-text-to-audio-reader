import { createRequire } from 'node:module';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { waitReaderWordVisible } from './reader-qa-helpers.mjs';
import { navigationPdf } from './navigation-fixture.mjs';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const staged = process.argv.includes('--staged');
const referenceBook = process.env.CADENCE_QA_BOOK || path.join(homedir(), 'Downloads', 'Poor Charlie’s Almanack_ The Wit and Wisdom of Charles T. Munger ( PDFDrive ).pdf');
const syntheticOnly = process.argv.includes('--synthetic-only');
const hasReferenceBook = !syntheticOnly && await access(referenceBook).then(() => true, () => false);
if (process.env.CADENCE_QA_BOOK && !syntheticOnly && !hasReferenceBook) throw new Error('CADENCE_QA_BOOK does not point to an available PDF.');
await mkdir('test-results/fixtures', { recursive: true });
await writeFile('test-results/fixtures/Structured book.pdf', navigationPdf());
await writeFile('test-results/fixtures/Novel.pdf', navigationPdf({ outline: false, novel: true, count: 5 }));
await writeFile('test-results/fixtures/Unstructured.pdf', navigationPdf({ outline: false, count: 5 }));
await writeFile('test-results/fixtures/Technical.md', '# Systems\n\nThis is a complete introduction to the systems.\n\n## Storage\n\nStorage has several useful properties.\n\n### Indexes\n\nIndexes help locate a record.\n\n# Networks\n\nA network connects computers.\n\n## Protocols\n\nProtocols define the conversation.');
const zip = new (require('jszip'))();
zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>');
const p = (text, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p('Architecture', 'Heading1')}${p('This paragraph belongs to architecture.')}${p('Components', 'Heading2')}${p('Each component has a clear purpose.')}<w:tbl><w:tr><w:tc>${p('A table cell remains readable.')}</w:tc></w:tr></w:tbl>${p('Deployment', 'Heading1')}${p('Deployment brings the system into use.')}</w:body></w:document>`);
await writeFile('test-results/fixtures/Structured Word.docx', await zip.generateAsync({ type: 'nodebuffer' }));
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/structure-navigation-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: [...(staged ? [] : ['.']), '--force-device-scale-factor=1'], env, timeout: 60000 });
const page = await app.firstWindow();
page.setDefaultTimeout(20000);
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
async function check(name, run) { await run(); checks.push(name); console.log(`PASS ${name}`); }
async function openNavigation() { if (await page.getByLabel('Document navigation', { exact: true }).getAttribute('aria-expanded') !== 'true') await page.getByLabel('Document navigation', { exact: true }).click(); }
async function upload(name) { await page.locator('input[type=file]').setInputFiles(`test-results/fixtures/${name}`); await page.getByRole('heading', { name: name.replace(/\.[^.]+$/, ''), exact: true, level: 1 }).waitFor(); await openNavigation(); }
const topic = title => page.locator('.navigation-topic').filter({ has: page.getByText(title, { exact: true }) });
const jump = async number => { const input = page.getByLabel('Go to original page', { exact: true }); await input.fill(String(number)); await input.press('Enter'); await page.waitForFunction(number => document.querySelector('.viewing-location')?.dataset.location === `page-${number}`, number); };
const mainTitles = () => page.locator('.navigation-list > .navigation-tree > li > .navigation-row .navigation-topic b').allTextContents();
try {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000);
    ipcMain.removeHandler('reader:synthesize');
    ipcMain.handle('reader:synthesize', async () => ({ samples: Float32Array.from({ length: 240000 }, (_, i) => .1 * Math.sin(i * 2 * Math.PI * 180 / 24000)), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }));
  });
  await upload('Structured book.pdf');
  await check('Chapters remain at the top level, with opening pages and collapsed subsections', async () => {
    assert.deepEqual(await mainTitles(), ['Opening pages', 'Chapter 1', 'Chapter 2 Budget Constraint']);
    assert.equal(await page.locator('.navigation-topic').count(), 3);
    await page.getByText('2 chapters', { exact: true }).waitFor();
    assert.equal(await topic('Opening pages').getAttribute('aria-current'), 'location');
    assert.equal(await topic('Chapter 1').getAttribute('aria-current'), null);
    await page.getByLabel('Expand Chapter 1', { exact: true }).click();
    assert.equal(await page.locator('.navigation-topic').count(), 5);
    assert.equal(await page.locator('.viewing-location').getAttribute('data-location'), 'page-1');
  });
  await check('Two headings on the same page have distinct, accurate reading targets', async () => {
    await topic('1.2 Supply').click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-3');
    const heading = page.locator('.passage').filter({ hasText: /^1\.2 Supply$/ });
    await heading.waitFor();
    await waitReaderWordVisible(heading, 4, 28);
    assert.equal(await topic('1.2 Supply').getAttribute('aria-current'), 'location');
    await topic('1.1 Demand').click();
    await page.waitForTimeout(150);
    assert.equal(await topic('1.1 Demand').getAttribute('aria-current'), 'location');
    assert.ok(await page.getByLabel('Play narration', { exact: true }).isVisible());
  });
  await check('Subsection search preserves its parent and original PDF jumps use the precise destination', async () => {
    await page.getByLabel('Filter document navigation', { exact: true }).fill('supply');
    assert.deepEqual(await page.locator('.navigation-topic b').allTextContents(), ['Chapter 1', '1.2 Supply']);
    await page.getByRole('button', { name: 'Document view', exact: true }).click();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    await topic('1.2 Supply').click();
    await page.waitForTimeout(200);
    const offset = await page.locator('.pdf-text-layer span').filter({ hasText: /^1\.2 Supply$/ }).evaluate(element => element.getBoundingClientRect().top - element.closest('.reader-scroll').getBoundingClientRect().top);
    const toolbar = await page.locator('.pdf-pagination').evaluate(element => element.getBoundingClientRect().bottom - element.closest('.reader-scroll').getBoundingClientRect().top);
    assert.ok(offset >= toolbar && offset < toolbar + 55, `Heading offset ${offset}, toolbar ${toolbar}`);
    await page.getByLabel('Filter document navigation', { exact: true }).fill('');
    await page.screenshot({ path: 'test-results/structured-navigation.png' });
  });
  await check('PDF page turns reset scroll and stale chapter destinations cannot override Go to audio', async () => {
    await page.getByLabel('Next PDF page', { exact: true }).click();
    await page.getByText('Page 4 of 50', { exact: true }).waitFor();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    assert.ok(await page.locator('[data-pdf-page="4"]').evaluate(element => Math.abs(element.getBoundingClientRect().top - element.closest('.reader-scroll').querySelector('.pdf-pagination').getBoundingClientRect().bottom - 12) < 10));
    await page.getByLabel('Previous PDF page', { exact: true }).click();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    assert.ok(await page.locator('[data-pdf-page="3"]').evaluate(element => Math.abs(element.getBoundingClientRect().top - element.closest('.reader-scroll').querySelector('.pdf-pagination').getBoundingClientRect().bottom - 12) < 10));
    await topic('1.2 Supply').click();
    await page.getByRole('button', { name: 'Go to audio', exact: true }).click();
    await page.getByText('Page 1 of 50', { exact: true }).waitFor();
    await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
    assert.ok(await page.locator('[data-pdf-page="1"] .pdf-text-layer span').filter({ hasText: /^On page 1 passage 1 we / }).evaluate(element => { const box = element.getBoundingClientRect(), scroller = element.closest('.reader-scroll'); return box.top >= scroller.querySelector('.pdf-pagination').getBoundingClientRect().bottom && box.bottom <= scroller.getBoundingClientRect().bottom; }));
  });
  await check('Page mode is bounded and supports page groups and direct search', async () => {
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    assert.equal(await page.locator('.navigation-entry').count(), 40);
    await page.getByLabel('Next page group', { exact: true }).click();
    assert.equal(await page.locator('.navigation-entry').count(), 10);
    await page.getByLabel('Filter document navigation', { exact: true }).fill('page 43');
    assert.equal(await page.locator('.navigation-entry').count(), 1);
    await page.getByLabel('Browse page 43', { exact: true }).click();
    await page.getByText('Page 43 of 50', { exact: true }).waitFor();
    await page.getByLabel('Locate current chapter or page', { exact: true }).click();
    assert.ok(await page.getByLabel('Browse page 43', { exact: true }).isVisible());
  });
  await check('Expanded branches persist and old saved indexes rebuild without reimporting', async () => {
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await jump(5);
    await page.waitForTimeout(600);
    await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onsuccess = () => { const db = request.result, tx = db.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval'), saved = store.get('cadence-library-index-v2'); saved.onsuccess = () => { const docs = saved.result; const doc = docs.find(item => item.title === 'Structured book'); doc.navigationVersion = 1; doc.topics = [{ title: 'Old incorrect topic', page: 43 }]; store.put(docs, 'cadence-library-index-v2'); }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
      request.onerror = () => reject(request.error);
    }));
    await page.reload(); await page.getByRole('heading', { name: 'Structured book', exact: true }).waitFor();
    await page.getByText('2 chapters', { exact: true }).waitFor();
    assert.deepEqual(await mainTitles(), ['Opening pages', 'Chapter 1', 'Chapter 2 Budget Constraint']);
    assert.equal(await page.getByLabel('Collapse Chapter 1', { exact: true }).getAttribute('aria-expanded'), 'true');
    await page.getByLabel('Rebuild contents', { exact: true }).click();
    await page.getByLabel('Rebuild contents', { exact: true }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[aria-label="Rebuild contents"]').disabled);
  });
  await check('Novel chapters are detected without bookmarks', async () => {
    await upload('Novel.pdf');
    assert.deepEqual(await mainTitles(), ['Opening pages', 'Chapter One', 'Chapter II']);
    await topic('Chapter II').click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-4');
  });
  await check('Unstructured documents retain honest page navigation', async () => {
    await upload('Unstructured.pdf');
    assert.equal(await page.locator('.navigation-entry').count(), 5);
    await page.getByRole('button', { name: 'Contents', exact: true }).click();
    await page.getByText('No reliable chapter structure was found. Use the page list to navigate this document.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Pages', exact: true }).click();
    await page.getByLabel('Browse page 4', { exact: true }).click();
  });
  await check('Markdown and Word preserve heading levels, text and table content', async () => {
    await upload('Technical.md');
    assert.deepEqual(await mainTitles(), ['Systems', 'Networks']);
    await page.getByLabel('Expand Systems', { exact: true }).click();
    await page.getByLabel('Expand Storage', { exact: true }).click();
    await topic('Indexes').click();
    assert.equal(await topic('Indexes').getAttribute('aria-current'), 'location');
    await upload('Structured Word.docx');
    assert.deepEqual(await mainTitles(), ['Architecture', 'Deployment']);
    await page.getByLabel('Expand Architecture', { exact: true }).click();
    await topic('Components').click();
    await page.locator('.passage').filter({ hasText: /^A table cell remains readable\.$/ }).waitFor();
    assert.equal(await page.locator('.passage').filter({ hasText: /^Each component has a clear purpose\.$/ }).count(), 1);
  });
  if (hasReferenceBook) await check('The real book shows four chapters and eleven talks nested within Chapter 4', async () => {
    await page.locator('input[type=file]').setInputFiles(referenceBook);
    await page.getByRole('heading', { name: /Poor Charlie/ }).waitFor({ timeout: 120000 });
    await openNavigation();
    await page.getByText('4 chapters', { exact: true }).waitFor();
    assert.equal((await mainTitles()).length, 6);
    await jump(2);
    assert.equal(await topic('Opening pages').getAttribute('aria-current'), 'location');
    await page.getByLabel('Expand Chapter 4: Eleven Talks', { exact: true }).click();
    assert.equal(await page.locator('[id^="branch-"] .navigation-topic').count(), 11);
    await page.getByLabel('Filter document navigation', { exact: true }).fill('Harvard');
    assert.deepEqual(await page.locator('.navigation-topic b').allTextContents(), ['Chapter 4: Eleven Talks', '1. Harvard School Commencement Speech']);
    await topic('1. Harvard School Commencement Speech').click();
    await page.waitForFunction(() => document.querySelector('.viewing-location')?.dataset.location === 'page-150');
    await page.getByLabel('Filter document navigation', { exact: true }).fill('');
    await page.screenshot({ path: 'test-results/real-book-navigation.png' });
  });
  else { console.log('SKIP optional real-book fixture; synthetic navigation fixtures remain available.'); await upload('Structured book.pdf'); }
  await check('Browsing, audio and sidebar scrolling stay independent; locate is explicit', async () => {
    await jump(2);
    const list = page.locator('.navigation-list');
    await list.evaluate(element => { element.scrollTop = 300; });
    const before = await list.evaluate(element => element.scrollTop);
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor();
    await jump(30);
    await page.waitForTimeout(1200);
    assert.equal(await list.evaluate(element => element.scrollTop), before);
    assert.ok(await page.getByLabel('Pause narration', { exact: true }).isVisible());
    assert.equal(await page.locator('.viewing-location').getAttribute('data-location'), 'page-30');
    await page.getByLabel('Locate current chapter or page', { exact: true }).click();
    assert.ok(await page.locator('.navigation-topic[aria-current="location"]').isVisible());
    await page.getByLabel('Pause narration', { exact: true }).click();
  });
  await check('Sidebar collapses and compact layouts have no horizontal overflow', async () => {
    const width = await page.locator('.reader-scroll').evaluate(element => element.clientWidth);
    await page.getByLabel('Close document navigation', { exact: true }).click();
    assert.ok(await page.locator('.reader-scroll').evaluate(element => element.clientWidth) > width + 230);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
    await openNavigation();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: 'test-results/navigation-compact.png' });
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/structure-navigation-results.json', JSON.stringify({ checks, errors, staged }, null, 2));
} catch (error) { await page.screenshot({ path: 'test-results/structure-navigation-failure.png' }); throw error; }
finally { await app.close(); }
