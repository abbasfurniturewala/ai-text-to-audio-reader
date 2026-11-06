import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), { _electron } = require('playwright');
const staged = process.argv.includes('--staged'), version = JSON.parse(await readFile('package.json', 'utf8')).version;
const output = path.resolve('test-results/shutdown'); await mkdir(output, { recursive: true });
const checks = [];
for (const phase of ['opening', 'ready', 'synthesizing']) {
  const env = { ...process.env, CADENCE_QA: '1', CADENCE_QA_OFFLINE: '1', CADENCE_DATA_DIR: path.join(output, `${phase}-${Date.now()}`) };
  delete env.ELECTRON_RUN_AS_NODE; delete env.CADENCE_DEV_URL;
  const app = await _electron.launch({ executablePath: staged ? path.resolve(`release/staged-${version}/win-unpacked/Cadence.exe`) : require('electron'), args: staged ? [] : ['.'], env, timeout: 60000 });
  const child = app.process(), page = await app.firstWindow(); let stdout = '', stderr = '', timer;
  child.stdout?.on('data', data => { stdout = (stdout + data).slice(-20000); }); child.stderr?.on('data', data => { stderr = (stderr + data).slice(-20000); });
  try {
    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      BrowserWindow.getAllWindows()[0].webContents.setAudioMuted(true);
      const { Worker } = process.getBuiltinModule('node:worker_threads'), emit = Worker.prototype.emit;
      Worker.prototype.emit = function (name, ...args) { if (name === 'exit') process.stdout.write(`CADENCE_WORKER_EXIT:${args[0]}\n`); return emit.call(this, name, ...args); };
      const synthesize = ipcMain._invokeHandlers.get('reader:synthesize'); globalThis.__shutdownRequests = 0;
      ipcMain.removeHandler('reader:synthesize'); ipcMain.handle('reader:synthesize', (...args) => { globalThis.__shutdownRequests++; return synthesize(...args); });
    });
    await page.waitForFunction(() => !!window.cadence);
    const initiallyReady = (await page.evaluate(() => window.cadence.status())).modelReady;
    if (phase !== 'opening') await page.evaluate(() => window.cadence.loadModel());
    if (phase === 'synthesizing') {
      await page.getByRole('heading', { name: 'The art of paying attention', exact: true }).waitFor();
      await page.getByLabel('Play narration', { exact: true }).click();
      for (let attempt = 0; !(await app.evaluate(() => globalThis.__shutdownRequests)) && attempt < 100; attempt++) await page.waitForTimeout(50);
      assert((await app.evaluate(() => globalThis.__shutdownRequests)) > 0, 'No real speech request observed');
    }
    const began = Date.now(), exited = new Promise((resolve, reject) => { child.once('exit', code => resolve(code)); timer = setTimeout(() => reject(new Error('Native cleanup exceeded 30 seconds')), 30000); });
    void exited.catch(() => {});
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(error => { if (!/closed|garbage collected/.test(error.message)) throw error; });
    assert.equal(await exited, 0, stderr);
    assert.deepEqual([...stdout.matchAll(/CADENCE_WORKER_EXIT:(\d+)/g)].map(match => Number(match[1])), [0], stderr);
    assert(!/Object has been destroyed|Uncaught Exception|crashpad_client_win/.test(stderr), stderr);
    checks.push({ phase, initiallyReady, exitMs: Date.now() - began, workerExit: 0 }); console.log('PASS ' + phase + ' shutdown ' + JSON.stringify(checks.at(-1)));
  } finally { clearTimeout(timer); if (child.exitCode === null) await app.close(); }
}
await writeFile(path.join(output, staged ? 'staged.json' : 'source.json'), JSON.stringify({ checks }, null, 2));
