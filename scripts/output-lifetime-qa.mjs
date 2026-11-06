import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { clickReaderWord, menuClick } from './reader-qa-helpers.mjs';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const output = path.resolve('test-results/output-lifetime'), staged = process.argv.includes('--staged'); await mkdir(output, { recursive: true });
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, 'profile-' + Date.now()) };
delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
const page = await app.firstWindow(), cdp = await page.context().newCDPSession(page), errors = [], nodes = new Map(), contexts = new Map(), created = [], destroyed = [], samples = [];
page.on('pageerror', error => errors.push(error.message));
cdp.on('WebAudio.contextCreated', ({ context }) => contexts.set(context.contextId, context));
cdp.on('WebAudio.contextChanged', ({ context }) => contexts.set(context.contextId, context));
cdp.on('WebAudio.audioNodeCreated', ({ node }) => { if (node.nodeType.includes('Worklet')) { nodes.set(node.nodeId, node); created.push(node.nodeId); } });
cdp.on('WebAudio.audioNodeWillBeDestroyed', ({ nodeId }) => { if (nodes.delete(nodeId)) destroyed.push(nodeId); });
cdp.on('WebAudio.contextWillBeDestroyed', ({ contextId }) => { contexts.delete(contextId); for (const [id, node] of nodes) if (node.contextId === contextId) nodes.delete(id); });
const openContexts = () => [...contexts.values()].filter(context => context.contextState !== 'closed');
const liveNodes = () => [...nodes.values()].filter(node => openContexts().some(context => context.contextId === node.contextId)).length;
await cdp.send('WebAudio.enable');
try {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
    ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', async () => ({ samples: new Float32Array(48000).fill(.1), bytes: new Uint8Array(), mime: 'audio/wav', sampleRate: 24000 }));
  });
  await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
  await menuClick(page.getByLabel('Paste text', { exact: true })); await page.getByLabel('Document title', { exact: true }).fill('Output lifetime');
  await page.getByLabel('Your text', { exact: true }).fill('A patient traveller follows the river through the valley, listening to birds and noticing the landscape. Another complete sentence provides enough text for repeated exact word starts.');
  await page.getByRole('button', { name: 'Add to my library' }).click(); await page.getByRole('heading', { name: 'Output lifetime', exact: true }).waitFor();
  for (let index = 0; index < 30; index++) {
    await clickReaderWord(page.locator('.passage').first(), index % 15); await page.getByLabel('Pause narration', { exact: true }).waitFor(); await page.waitForTimeout(80);
    if (index % 5 === 4) { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(100); samples.push({ starts: index + 1, live: liveNodes(), openContexts: openContexts().length, heap: (await cdp.send('Runtime.getHeapUsage')).usedSize }); }
  }
  assert(created.length >= 30, `Observed only ${created.length} output processors`);
  assert(contexts.size > 0 && openContexts().length > 0, 'Audio context state instrumentation is missing');
  assert(samples.slice(1).every(sample => sample.live <= 2), JSON.stringify(samples));
  assert(samples.every(sample => sample.openContexts <= 2), JSON.stringify(samples));
  await page.getByLabel('Close document', { exact: true }).click(); await page.waitForTimeout(150); await cdp.send('HeapProfiler.collectGarbage');
  assert.equal(liveNodes(), 0); assert.equal(openContexts().length, 0); assert.deepEqual(errors, []);
  const report = { created: created.length, destroyed: destroyed.length, liveAfterClose: liveNodes(), contexts: [...contexts.values()].map(context => context.contextState), samples, errors };
  await writeFile(path.join(output, staged ? 'staged.json' : 'source.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { await app.close(); }
