// Exposes a minimal, safe API to the renderer. All device/network I/O happens
// in the main process; the renderer only calls these.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tallywatch', {
  discoverStart: () => ipcRenderer.invoke('discover:start'),
  discoverStop: () => ipcRenderer.invoke('discover:stop'),
  discoverList: () => ipcRenderer.invoke('discover:list'),
  onBeaconsUpdated: (cb) => ipcRenderer.on('beacons:updated', (_e, list) => cb(list)),

  status: (ip) => ipcRenderer.invoke('beacon:status', ip),
  identify: (ip) => ipcRenderer.invoke('beacon:identify', ip),
  reboot: (ip) => ipcRenderer.invoke('beacon:reboot', ip),
  setLabel: (ip, value) => ipcRenderer.invoke('beacon:setLabel', ip, value),
  setIp: (ip, cfg) => ipcRenderer.invoke('beacon:setIp', ip, cfg),
  push: (ip) => ipcRenderer.invoke('beacon:push', ip),
  openSetup: (ip) => ipcRenderer.invoke('beacon:openSetup', ip),

  firmwareActive: () => ipcRenderer.invoke('firmware:active'),
  githubCheck: () => ipcRenderer.invoke('github:check'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  adapters: () => ipcRenderer.invoke('sys:adapters'),
  ipInUse: (ip) => ipcRenderer.invoke('net:ipInUse', ip),
});
