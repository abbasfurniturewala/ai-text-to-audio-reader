import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const JSZip = require('jszip');
await mkdir('test-results/fixtures', { recursive: true });

function pdfFixture() {
  const stream = 'BT /F1 20 Tf 72 720 Td (A small adventure) Tj 0 -40 Td /F1 12 Tf (This PDF can be read aloud with a natural local voice.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n', offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}
await writeFile('test-results/fixtures/Adventure.pdf', pdfFixture());
await writeFile('test-results/fixtures/Quiet moments.txt', 'Quiet moments\n\nThe best stories make space for a little wonder. Let us take a walk and listen to the world.\n\nOne step at a time, the day begins to open up.');
const zip = new JSZip();
zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A Word document</w:t></w:r></w:p><w:p><w:r><w:t>This Word document contains a passage ready for narration.</w:t></w:r></w:p></w:body></w:document>');
await writeFile('test-results/fixtures/Words.docx', await zip.generateAsync({ type: 'nodebuffer' }));
const env = { ...process.env, CADENCE_DATA_DIR: path.resolve(`test-results/user-data-${Date.now()}`), CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const qaVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const qaExecutable = process.env.CADENCE_QA_EXECUTABLE || (process.argv.includes('--staged') ? path.resolve(`release/staged-${qaVersion}/win-unpacked/Cadence.exe`) : process.argv.includes('--packaged') ? path.resolve('release/win-unpacked/Cadence.exe') : undefined);
const app = await _electron.launch({ executablePath: qaExecutable || require('electron'), args: qaExecutable ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text().slice(0, 200)); });
const checks = [];
async function check(name, action) { await action(); checks.push(name); console.log(`PASS ${name}`); }
try {
  await page.getByRole('heading', { name: 'The art of paying attention' }).waitFor();
  await check('Desktop bridge available', async () => { assert.equal((await page.evaluate(() => window.cadence.status())).desktop, true); });
  await page.screenshot({ path: 'test-results/reader-desktop.png' });
  await check('Eight local voices', async () => { assert.equal(await page.locator('.voice-option').count(), 8); });
  await check('Voice selection and filter', async () => {
    await page.locator('.voice-option').filter({ hasText: 'George' }).click();
    await page.locator('.selected-voice h3').filter({ hasText: 'George' }).waitFor();
    await page.getByLabel('Filter voices').selectOption('British'); assert.equal(await page.locator('.voice-option').count(), 2);
    await page.getByLabel('Filter voices').selectOption('All voices');
    await page.locator('.voice-option').filter({ hasText: 'Heart' }).click();
  });
  await check('Paste text and saved library', async () => {
    await page.getByLabel('Paste text', { exact: true }).click();
    await page.getByLabel('Document title', { exact: true }).fill('A listening test');
    await page.getByLabel('Your text', { exact: true }).fill('A fresh start\n\nA good story stays with you. Settle in, take a breath, and let the words come to you.\n\nThis is our second paragraph, ready for a different voice.');
    await page.getByRole('button', { name: 'Add to my library' }).click();
    await page.getByRole('heading', { name: 'A listening test', exact: true }).waitFor();
  });
  await check('Bookmark a passage', async () => {
    await page.locator('.passage').nth(1).click();
    await page.getByLabel('Bookmark current passage', { exact: true }).click();
    await page.getByRole('button', { name: /^Bookmarks/ }).click();
    await page.locator('.bookmark-card').filter({ hasText: 'A listening test' }).click();
    assert.equal(await page.locator('.current-passage').textContent(), 'A good story stays with you. Settle in, take a breath, and let the words come to you.');
  });
  await check('Search and type controls', async () => {
    await page.getByLabel('Search document', { exact: true }).click();
    await page.getByLabel('Search document text', { exact: true }).fill('different');
    assert.equal(await page.locator('.passage').count(), 1);
    await page.getByLabel('Close search', { exact: true }).click();
    await page.getByLabel('Larger text', { exact: true }).click();
    await page.getByLabel('Change typeface', { exact: true }).click();
    assert.equal(await page.locator('.reading-paper.sans').count(), 1);
  });
  await check('Real local neural playback and pause', async () => {
    await page.getByLabel('Play narration', { exact: true }).click();
    await page.getByLabel('Pause narration', { exact: true }).waitFor({ timeout: 180000 });
    await page.getByLabel('Pause narration', { exact: true }).click();
    await page.getByText('TAKE YOUR TIME', { exact: true }).waitFor();
    await page.getByLabel('Next passage', { exact: true }).click();
  });
  await check('Audio export generates a real WAV', async () => {
    await page.getByRole('button', { name: 'Export audio', exact: true }).click();
    await page.getByRole('button', { name: 'Create audio file' }).click();
    await page.getByRole('button', { name: 'Save WAV', exact: true }).waitFor({ timeout: 240000 });
    const destination = path.resolve('test-results/exported-narration.wav');
    await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, destination);
    await page.getByRole('button', { name: 'Save WAV', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Your audio has been saved' }).waitFor();
    const saved = await readFile(destination);
    assert.equal(saved.toString('ascii', 0, 4), 'RIFF'); assert.ok(saved.length > 100000);
    await page.screenshot({ path: 'test-results/audio-export.png' });
    await page.getByLabel('Close dialog', { exact: true }).click();
  });
  await check('PDF import and original page rendering', async () => {
    await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Adventure.pdf');
    await page.getByRole('heading', { name: 'Adventure', exact: true }).waitFor();
    await page.locator('.passage').filter({ hasText: 'This PDF can be read aloud' }).waitFor();
    await page.getByRole('button', { name: 'Original PDF', exact: true }).click();
    await page.locator('.pdf-loading').waitFor({ state: 'detached' });
    const width = await page.locator('.pdf-page canvas').evaluate(canvas => canvas.width); assert.ok(width > 600);
    await page.screenshot({ path: 'test-results/pdf-reader.png' });
  });
  await check('DOCX import', async () => {
    await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Words.docx');
    await page.getByRole('heading', { name: 'Words', exact: true }).waitFor();
    await page.locator('.passage').filter({ hasText: 'This Word document contains' }).waitFor();
  });
  await check('TXT import', async () => {
    await page.locator('input[type=file]').setInputFiles('test-results/fixtures/Quiet moments.txt');
    await page.getByRole('heading', { name: 'Quiet moments', exact: true }).waitFor();
    await page.locator('.passage').filter({ hasText: 'The best stories' }).waitFor();
  });
  await check('Invalid file handled without library loss', async () => {
    await page.locator('input[type=file]').setInputFiles({ name: 'old.doc', mimeType: 'application/msword', buffer: Buffer.from('invalid') });
    await page.getByRole('alert').filter({ hasText: 'save a copy as DOCX' }).waitFor();
    await page.getByRole('heading', { name: 'Quiet moments', exact: true }).waitFor();
  });
  await check('Settings and local model readiness', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Local voices are ready', exact: true }).waitFor();
    assert.equal(await page.getByText('ElevenLabs').count(), 0);
    await page.getByLabel('Close dialog', { exact: true }).click();
  });
  await check('Player controls are centered and include narration speed near the player', async () => {
    assert.equal(await page.locator('.voice-panel').getByLabel('Narration speed').count(), 0);
    assert.equal(await page.locator('.player .playback-controls').getByLabel('Narration speed').count(), 1);
    const alignment = await page.evaluate(() => {
      const player = document.querySelector('.player').getBoundingClientRect();
      const controls = document.querySelector('.player .playback-controls').getBoundingClientRect();
      return Math.abs((controls.left + controls.right) / 2 - (player.left + player.right) / 2);
    });
    assert.ok(alignment <= 2, `Playback controls off-center by ${alignment}px`);
  });
  await check('Persistence across reload', async () => {
    await page.waitForTimeout(700);
    await page.reload();
    await page.getByRole('heading', { name: 'Quiet moments', exact: true }).waitFor();
    await page.getByRole('button', { name: /^Bookmarks/ }).click();
    assert.equal(await page.locator('.bookmark-card').count(), 1);
  });
  await page.getByRole('button', { name: /^My library/ }).click();
  await page.screenshot({ path: 'test-results/library-desktop.png' });
  await check('Layout at 1024 × 768', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1024, 768));
    await page.locator('.recent-document').first().click();
    await page.screenshot({ path: 'test-results/reader-compact.png' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.getByLabel('Play narration', { exact: true }).isVisible(), true);
  });
  await check('No uncaught renderer exceptions', async () => assert.deepEqual(errors, []));
  await writeFile('test-results/desktop-results.json', JSON.stringify({ checks, errors }, null, 2));
} finally { await app.close(); }
