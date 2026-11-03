const { app, BrowserWindow, ipcMain, safeStorage, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');

app.setName('Cadence');
if (process.env.CADENCE_DATA_DIR) app.setPath('userData', process.env.CADENCE_DATA_DIR);
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
let window, speechWorker, sequence = 0, apiKey = '', modelReady = false, readerFullScreen = false;
const pending = new Map();
const speechRequests = new Map();
const keyPath = () => path.join(app.getPath('userData'), 'eleven-key.enc');

function assertSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted request.');
}
function handle(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => { assertSender(event); return listener(...args); });
}
function workerRequest(action, request = {}) {
  if (!speechWorker) {
    const bundled = app.isPackaged ? path.join(process.resourcesPath, 'models') : null;
    speechWorker = new Worker(path.join(__dirname, 'speech-worker.mjs'), {
      workerData: { cacheDir: bundled || path.join(__dirname, '../.cache/models'), offline: app.isPackaged || process.env.CADENCE_QA_OFFLINE === '1' },
    });
    speechWorker.on('message', message => {
      if (message.type === 'progress') { window?.webContents.send('reader:model-progress', message.progress); return; }
      const promise = pending.get(message.id);
      if (!promise) return;
      pending.delete(message.id);
      if (message.error) promise.reject(new Error(message.error));
      else { if (message.ready) { modelReady = true; window?.webContents.send('reader:model-progress', { status: 'ready' }); } promise.resolve(message.result); }
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
async function elevenFetch(route, options = {}) {
  if (!apiKey) throw new Error('Connect your ElevenLabs API key in Settings first.');
  const response = await fetch(`https://api.elevenlabs.io${route}`, {
    ...options, headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', ...options.headers },
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    let detail; try { detail = (await response.json()).detail; } catch { /* Status is enough. */ }
    const message = typeof detail === 'string' ? detail : detail?.message;
    throw new Error(message || (response.status === 401 ? 'Your ElevenLabs API key was not accepted.' : `ElevenLabs request failed (${response.status}).`));
  }
  return response;
}
async function getElevenVoices() {
  let token, voices = [];
  do {
    const query = new URLSearchParams({ page_size: '100' });
    if (token) query.set('next_page_token', token);
    const data = await (await elevenFetch(`/v2/voices?${query}`)).json();
    voices.push(...(data.voices || [])); token = data.has_more ? data.next_page_token : undefined;
  } while (token && voices.length < 500);
  return voices.map(v => ({ id: v.voice_id, name: v.name, accent: v.labels?.accent || 'Multilingual', gender: v.labels?.gender || 'Voice', description: v.labels?.description || v.description || 'Natural ElevenLabs voice' }));
}

async function setup() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  try { if (safeStorage.isEncryptionAvailable()) apiKey = safeStorage.decryptString(await fs.readFile(keyPath())); } catch { /* First launch. */ }
  handle('reader:status', () => ({ desktop: true, connected: !!apiKey, modelReady, version: app.getVersion() }));
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
    speechRequests.get(requestId)?.abort();
    speechWorker?.postMessage({ action: 'cancel', requestId });
  });
  handle('reader:synthesize', async request => {
    validateSpeech(request);
    if (request.engine === 'local') return workerRequest('generate', { text: request.text, voice: request.voice, requestId: request.requestId, priority: request.priority });
    if (request.engine !== 'eleven') throw new Error('Unknown voice engine.');
    const model = ['eleven_v3', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'].includes(request.model) ? request.model : 'eleven_multilingual_v2';
    const controller = new AbortController();
    if (request.requestId) speechRequests.set(request.requestId, controller);
    try {
    const response = await elevenFetch(`/v1/text-to-speech/${request.voice}?output_format=mp3_44100_128`, {
      method: 'POST', signal: controller.signal, body: JSON.stringify({ text: request.text, model_id: model,
        voice_settings: model === 'eleven_v3' ? { stability: 0.5 } : { stability: 0.45, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
      }),
    });
    return { bytes: new Uint8Array(await response.arrayBuffer()), mime: 'audio/mpeg', sampleRate: 44100 };
    } finally { if (request.requestId) speechRequests.delete(request.requestId); }
  });
  handle('reader:connect-eleven', async key => {
    if (typeof key !== 'string' || key.trim().length < 10 || key.length > 500) throw new Error('Enter a valid ElevenLabs API key.');
    const previousKey = apiKey; apiKey = key.trim();
    try {
      const voices = await getElevenVoices();
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. Your key has not been saved.');
      await fs.writeFile(keyPath(), safeStorage.encryptString(apiKey));
      return voices;
    } catch (error) { apiKey = previousKey; throw error; }
  });
  handle('reader:disconnect-eleven', async () => { await fs.rm(keyPath(), { force: true }); apiKey = ''; return true; });
  handle('reader:eleven-voices', getElevenVoices);
  handle('reader:save-audio', async (bytes, name) => {
    if (!(bytes instanceof Uint8Array) || bytes.length > 1024 * 1024 * 1024) throw new Error('Invalid audio file.');
    const filename = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 120) || 'Cadence audio';
    const result = await dialog.showSaveDialog(window, { defaultPath: `${filename}.wav`, filters: [{ name: 'WAV audio', extensions: ['wav'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.writeFile(result.filePath, bytes); return true;
  });
  session.defaultSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'mediaKeySystem'));
  // Load in parallel with the window and saved library, before Play is pressed.
  void workerRequest('load').catch(() => {});
  window = new BrowserWindow({ width: 1480, height: 960, minWidth: 1000, minHeight: 700, backgroundColor: '#f6f5f1', show: !process.env.CADENCE_QA, icon: path.join(__dirname, 'icon.png'),
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
app.on('window-all-closed', () => { speechWorker?.terminate(); app.quit(); });
