const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');
const { profileDirectory } = require('./profile-path.cjs');

app.setName('Cadence');
// AppData is virtualized when launched by packaged hosts such as Codex.
app.setPath('userData', profileDirectory(app.getPath('home'), process.env));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let window, speechWorker, sequence = 0, modelReady = false, readerFullScreen = false;
const pending = new Map();
let exportWorker, exportSequence = 0;
const exportPending = new Map();
function exportRuntimeRoot() {
  if (!app.isPackaged) return path.join(__dirname, '../.cache/audiobook');
  const candidates = ['../../..', '../../../..'].map(parent => path.resolve(process.resourcesPath, parent, '.cache/audiobook'));
  return candidates.find(folder => require('node:fs').existsSync(path.join(folder, 'runtime.json'))) || candidates[0];
}
function exportRequest(action, input = {}) {
  if (!exportWorker) {
    exportWorker = new Worker(path.join(__dirname, 'audiobook-worker.mjs'), { workerData: {
      root: path.join(app.getPath('userData'), 'audiobook-jobs'),
      runtimeRoot: exportRuntimeRoot(),
      modelRoot: app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, '../.cache/models'),
    } });
    exportWorker.on('message', message => {
      if (message.type) { if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('reader:export-progress', message); return; }
      const promise = exportPending.get(message.id); if (!promise) return; exportPending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error)); else promise.resolve(message.result);
    });
    const failed = error => { for (const promise of exportPending.values()) promise.reject(error); exportPending.clear(); exportWorker = null; };
    exportWorker.on('error', failed); exportWorker.on('exit', () => failed(new Error('The export engine stopped. Completed phrases are saved; reopen Audio exports to resume.')));
  }
  const id = ++exportSequence;
  return new Promise((resolve, reject) => { exportPending.set(id, { resolve, reject }); exportWorker.postMessage({ id, action, ...input }); });
}

function assertSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted request.');
}
function handle(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => { assertSender(event); return listener(...args); });
}
function modelProgress(progress) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('reader:model-progress', progress);
}
function workerRequest(action, request = {}) {
  if (!speechWorker) {
    const bundled = app.isPackaged ? path.join(process.resourcesPath, 'models') : null;
    speechWorker = new Worker(path.join(__dirname, 'speech-worker.mjs'), {
      workerData: { cacheDir: bundled || path.join(__dirname, '../.cache/models'), offline: app.isPackaged || process.env.CADENCE_QA_OFFLINE === '1' },
    });
    speechWorker.on('message', message => {
      if (message.type === 'progress') { modelProgress(message.progress); return; }
      const promise = pending.get(message.id);
      if (!promise) return;
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error));
      else { if (message.ready) { modelReady = true; modelProgress({ status: 'ready' }); } promise.resolve(message.result); }
    });
    const fail = (error) => {
      for (const promise of pending.values()) promise.reject(error);
      pending.clear(); speechWorker = null; modelReady = false;
    };
    speechWorker.on('error', fail);
    speechWorker.on('exit', code => { if (code !== 0) fail(new Error('The voice engine stopped. Please try again.')); });
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); speechWorker.postMessage({ id, action, ...request }); });
}

function validateSpeech(request) {
  if (!request || typeof request.text !== 'string' || !request.text.trim() || request.text.length > 1800) throw new Error('Speech segments must contain 1–1,800 characters.');
  if (typeof request.voice !== 'string' || !/^[a-zA-Z0-9_-]{2,100}$/.test(request.voice)) throw new Error('Choose a valid voice.');
  if (request.requestId !== undefined && (typeof request.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.requestId))) throw new Error('Invalid speech request.');
}
async function setup() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  handle('reader:status', () => ({ desktop: true, modelReady, version: app.getVersion() }));
  handle('reader:full-screen', () => readerFullScreen);
  handle('reader:set-full-screen', enabled => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid full screen request.');
    readerFullScreen = enabled;
    window.setFullScreen(enabled);
    window.webContents.send('reader:full-screen-changed', enabled);
    return enabled;
  });
  handle('reader:load-model', () => workerRequest('load'));
  handle('reader:cancel-speech', requestId => {
    if (typeof requestId !== 'string' || requestId.length > 100) return;
    speechWorker?.postMessage({ action: 'cancel', requestId });
  });
  handle('reader:synthesize', async request => {
    validateSpeech(request);
    return workerRequest('generate', { text: request.text, voice: request.voice, requestId: request.requestId, priority: request.priority });
  });
  handle('reader:save-audio', async (bytes, name) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 1024 * 1024 * 1024) throw new Error('Invalid audio file.');
    const filename = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 120) || 'Cadence audio';
    const result = await dialog.showSaveDialog(window, { defaultPath: `${filename}.wav`, filters: [{ name: 'WAV audio', extensions: ['wav'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, bytes); return true;
  });
  handle('reader:export-runtime', () => exportRequest('runtime'));
  handle('reader:export-list', () => exportRequest('list'));
  handle('reader:export-create', async request => {
    if (!request?.document || typeof request.document.title !== 'string') throw new Error('Choose a document to export.');
    const filename = request.document.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 100) || 'Cadence audiobook';
    const result = await dialog.showSaveDialog(window, { defaultPath: `${filename}.m4b`, filters: [{ name: 'Chaptered audiobook', extensions: ['m4b'] }] });
    if (result.canceled || !result.filePath) return null;
    return exportRequest('create', { request, output: result.filePath });
  });
  handle('reader:export-control', (jobId, action) => {
    if (typeof jobId !== 'string' || (jobId !== 'sample' && !/^[a-f0-9-]{36}$/.test(jobId)) || !['pause', 'resume', 'queue', 'unqueue', 'delete'].includes(action) || (jobId === 'sample' && action !== 'pause')) throw new Error('Invalid export action.');
    return exportRequest(action, { jobId });
  });
  handle('reader:export-sample', request => exportRequest('sample', { request }));
  handle('reader:export-reveal', async jobId => {
    const job = (await exportRequest('list')).find(item => item.id === jobId);
    if (!job || job.status !== 'complete') throw new Error('Finish the audiobook before opening its folder.');
    try { await fs.access(job.output); } catch { throw new Error('The audiobook file has moved or is no longer available. Its export history is kept here.'); }
    shell.showItemInFolder(job.output);
  });
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'mediaKeySystem'));
  // Load in parallel with the window and saved library, before Play is pressed.
  void workerRequest('load').catch(() => {});
  window = new BrowserWindow({ width: 1480, height: 960, minWidth: 1000, minHeight: 700, backgroundColor: '#edf1f6', show: !process.env.CADENCE_QA, icon: path.join(__dirname, 'icon.png'),
    title: 'Cadence', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: !!process.env.CADENCE_QA },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let closeAllowed = false, closeRequested = false, closeTimer;
  const finishClose = () => {
    if (closeAllowed || window.isDestroyed()) return;
    clearTimeout(closeTimer);
    session.defaultSession.flushStorageData();
    closeAllowed = true;
    window.close();
  };
  ipcMain.on('reader:close-ready', event => {
    if (closeRequested && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) finishClose();
  });
  window.on('close', event => {
    if (closeAllowed) return;
    event.preventDefault();
    if (closeRequested) return;
    closeRequested = true;
    window.webContents.send('reader:before-close');
    // A hung renderer must not trap the user in the application.
    closeTimer = setTimeout(finishClose, 2000);
  });
  for (const [event, enabled] of [['enter-full-screen', true], ['leave-full-screen', false]]) {
    window.on(event, () => {
      readerFullScreen = enabled;
      window.webContents.send('reader:full-screen-changed', enabled);
    });
  }
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (process.env.CADENCE_DEV_URL) await window.loadURL(process.env.CADENCE_DEV_URL);
  else await window.loadFile(path.join(__dirname, '../dist/index.html'));
}
app.on('second-instance', () => {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  if (!process.env.CADENCE_QA) { window.show(); window.focus(); }
});
if (primaryInstance) app.whenReady().then(setup);
app.on('window-all-closed', async () => {
  await Promise.all([
    exportWorker ? exportRequest('shutdown').catch(() => {}) : Promise.resolve(),
    speechWorker ? new Promise(resolve => { speechWorker.once('exit', resolve); speechWorker.postMessage({ action: 'shutdown' }); }) : Promise.resolve(),
  ]);
  app.quit();
});
