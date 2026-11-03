import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { _electron } = require('playwright');
const baseline = process.argv.includes('--baseline');
const staged = process.argv.includes('--staged');
const book = process.argv.find(arg => arg.toLowerCase().endsWith('.pdf'));
if (!book) throw new Error('Pass the PDF to profile.');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const label = baseline ? 'before' : 'after';
await mkdir('test-results', { recursive: true });
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.resolve(`test-results/memory-${label}-${Date.now()}`) };
delete env.ELECTRON_RUN_AS_NODE;
const executablePath = baseline ? path.resolve('release/win-unpacked/Cadence.exe') : staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron');
const app = await _electron.launch({ executablePath, args: [...(baseline || staged ? [] : ['.']), '--force-device-scale-factor=1'], env, timeout: 60000 });
const page = await app.firstWindow();
const cdp = await page.context().newCDPSession(page);
page.setDefaultTimeout(180000);
const snapshots = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
async function sample(phase) {
  await page.waitForTimeout(2500);
  const processes = await app.evaluate(({ app }) => app.getAppMetrics().map(({ type, memory }) => ({ type, ...memory })));
  const dom = await page.evaluate(() => ({ elements: document.getElementsByTagName('*').length, words: document.querySelectorAll('.read-word').length, sections: document.querySelectorAll('.reading-page-section').length }));
  const heap = await cdp.send('Runtime.getHeapUsage');
  const snapshot = { phase, workingSetMB: Math.round(processes.reduce((n, p) => n + p.workingSetSize, 0) / 1024), heapUsedMB: Math.round(heap.usedSize / 1048576), processes, ...dom };
  snapshots.push(snapshot); console.log(JSON.stringify(snapshot));
  await writeFile(`test-results/memory-${label}.json`, JSON.stringify({ snapshots, errors }, null, 2));
}
try {
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await page.waitForFunction(async () => (await window.cadence.status()).modelReady);
  await sample('welcome');
  await page.locator('input[type=file]').setInputFiles(book);
  await page.getByRole('heading', { name: path.basename(book, '.pdf').replaceAll('_', ' '), exact: true }).waitFor();
  await sample('book-reading');
  await page.getByLabel('Play narration', { exact: true }).click();
  await page.getByLabel('Pause narration', { exact: true }).waitFor();
  await page.waitForTimeout(5000);
  await sample('book-playing');
  await page.getByLabel('Pause narration', { exact: true }).click();
  await page.getByRole('button', { name: 'Original PDF', exact: true }).click();
  await page.locator('.pdf-loading').waitFor({ state: 'hidden' });
  await sample('book-original');
  if (!baseline) {
    for (let i = 2; i <= 3; i++) {
      await page.locator('input[type=file]').setInputFiles(book);
      await page.locator('.import-status').waitFor({ state: 'hidden' });
      await page.locator('.reading-page-section').first().waitFor();
      await sample(`${i}-books-in-library`);
    }
    await page.getByLabel('Close document', { exact: true }).click();
    await sample('all-books-closed');
    await page.waitForTimeout(10000);
    await sample('closed-after-idle');
    if (errors.length) throw new Error(errors.join('\n'));
  }
} finally { await app.close(); }
