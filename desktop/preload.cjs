const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cadence', {
  onBeforeClose: listener => {
    const handler = () => { Promise.resolve().then(listener).catch(() => {}).finally(() => ipcRenderer.send('reader:close-ready')); };
    ipcRenderer.on('reader:before-close', handler);
    return () => ipcRenderer.removeListener('reader:before-close', handler);
  },
  status: () => ipcRenderer.invoke('reader:status'),
  fullScreen: () => ipcRenderer.invoke('reader:full-screen'),
  setFullScreen: enabled => ipcRenderer.invoke('reader:set-full-screen', enabled),
  onFullScreen: listener => {
    const handler = (_, enabled) => listener(enabled);
    ipcRenderer.on('reader:full-screen-changed', handler);
    return () => ipcRenderer.removeListener('reader:full-screen-changed', handler);
  },
  loadModel: () => ipcRenderer.invoke('reader:load-model'),
  synthesize: (request) => ipcRenderer.invoke('reader:synthesize', request),
  cancelSpeech: (requestId) => ipcRenderer.invoke('reader:cancel-speech', requestId),
  saveAudio: (bytes, name) => ipcRenderer.invoke('reader:save-audio', bytes, name),
  onModelProgress: (listener) => {
    const handler = (_, progress) => listener(progress);
    ipcRenderer.on('reader:model-progress', handler);
    return () => ipcRenderer.removeListener('reader:model-progress', handler);
  },
});
