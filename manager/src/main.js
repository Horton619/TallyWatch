// TallyWatch Manager — main process
// ----------------------------------
// Owns all device and network I/O so the renderer never makes cross-origin
// requests to beacons (no CORS to fight). Responsibilities:
//   - mDNS discovery of beacons (_tallywatch._tcp)
//   - HTTP calls to each beacon (status, label, identify, reboot, OTA push)
//   - GitHub release check + local firmware caching (the "courier" model: pull
//     when the laptop is online, push to beacons on the isolated show network)

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Bonjour } = require('bonjour-service');

const SETTINGS_PATH = () => path.join(app.getPath('userData'), 'settings.json');
const CACHE_DIR = () => path.join(app.getPath('userData'), 'firmware-cache');

const DEFAULT_SETTINGS = {
  githubOwner: 'Horton619',
  githubRepo: 'TallyWatch',
  githubToken: '', // required only for a private repo
};

let mainWindow = null;
let bonjour = null;
let browser = null;
const beacons = new Map(); // ip -> { ip, id, fw, host }

// ---------- settings ----------
function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH(), 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_PATH(), JSON.stringify(s, null, 2));
}

// ---------- HTTP helpers ----------
async function fetchWithTimeout(url, opts = {}, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function beaconStatus(ip) {
  const r = await fetchWithTimeout(`http://${ip}/status`);
  if (!r.ok) throw new Error('status ' + r.status);
  return r.json();
}

// ---------- mDNS discovery ----------
function startDiscovery() {
  stopDiscovery();
  bonjour = new Bonjour();
  browser = bonjour.find({ type: 'tallywatch' });

  const upsert = (svc) => {
    const ip = (svc.addresses || []).find((a) => a.includes('.')) || svc.referer?.address;
    if (!ip) return;
    beacons.set(ip, {
      ip,
      id: svc.txt?.id || svc.name || '',
      fw: svc.txt?.fw || '',
      host: svc.host || '',
    });
    pushBeaconList();
  };

  browser.on('up', upsert);
  browser.on('down', (svc) => {
    const ip = (svc.addresses || []).find((a) => a.includes('.'));
    if (ip) beacons.delete(ip);
    pushBeaconList();
  });
}

function stopDiscovery() {
  if (browser) { try { browser.stop(); } catch {} browser = null; }
  if (bonjour) { try { bonjour.destroy(); } catch {} bonjour = null; }
}

function pushBeaconList() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('beacons:updated', [...beacons.values()]);
  }
}

// ---------- GitHub firmware check ----------
async function githubCheck() {
  const s = loadSettings();
  const headers = { 'User-Agent': 'TallyWatch-Manager', Accept: 'application/vnd.github+json' };
  if (s.githubToken) headers.Authorization = `Bearer ${s.githubToken}`;

  const api = `https://api.github.com/repos/${s.githubOwner}/${s.githubRepo}/releases/latest`;
  const r = await fetchWithTimeout(api, { headers }, 8000);
  if (!r.ok) throw new Error(`GitHub ${r.status} — ${r.status === 404 ? 'no releases yet, or private repo needs a token' : 'check owner/repo/token'}`);
  const rel = await r.json();

  const asset = (rel.assets || []).find((a) => a.name.endsWith('.bin'));
  if (!asset) throw new Error('Release has no .bin asset');

  fs.mkdirSync(CACHE_DIR(), { recursive: true });
  const dest = path.join(CACHE_DIR(), asset.name);

  if (!fs.existsSync(dest)) {
    // GitHub asset download needs the octet-stream Accept + token for private repos
    const dl = await fetchWithTimeout(asset.url, {
      headers: { ...headers, Accept: 'application/octet-stream' },
    }, 30000);
    if (!dl.ok) throw new Error('Download failed ' + dl.status);
    fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
  }

  return { version: (rel.tag_name || '').replace(/^v/, ''), asset: asset.name, path: dest, cached: true };
}

let cachedFirmware = null; // { version, path } from the last githubCheck

async function pushFirmware(ip) {
  if (!cachedFirmware) throw new Error('No firmware cached — run Check for Updates while online first');
  const buf = fs.readFileSync(cachedFirmware.path);
  const form = new FormData();
  form.append('firmware', new Blob([buf], { type: 'application/octet-stream' }), 'firmware.bin');
  const r = await fetchWithTimeout(`http://${ip}/update/firmware`, { method: 'POST', body: form }, 60000);
  const text = await r.text().catch(() => '');
  return { ok: r.ok && text.startsWith('OK'), text };
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('discover:start', () => { startDiscovery(); return true; });
  ipcMain.handle('discover:stop', () => { stopDiscovery(); return true; });
  ipcMain.handle('discover:list', () => [...beacons.values()]);

  ipcMain.handle('beacon:status', (_e, ip) => beaconStatus(ip));
  ipcMain.handle('beacon:identify', (_e, ip) => fetchWithTimeout(`http://${ip}/identify`).then((r) => r.ok));
  ipcMain.handle('beacon:reboot', (_e, ip) => fetchWithTimeout(`http://${ip}/reboot`).then((r) => r.ok));
  ipcMain.handle('beacon:setLabel', (_e, ip, value) =>
    fetchWithTimeout(`http://${ip}/setlabel?value=${encodeURIComponent(value)}`, { method: 'POST' }).then((r) => r.ok));
  ipcMain.handle('beacon:push', (_e, ip) => pushFirmware(ip));

  ipcMain.handle('github:check', async () => { cachedFirmware = await githubCheck(); return cachedFirmware; });
  ipcMain.handle('github:cached', () => cachedFirmware);

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_e, s) => { saveSettings(s); return true; });
  ipcMain.handle('sys:hostSubnet', () => hostSubnetHint());
}

// Helper for the UI: which subnet is this laptop on? (reminds the operator to
// join the tally WiFi, since discovery only works on the beacon subnet)
function hostSubnetHint() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const list of Object.values(ifaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
    }
  }
  return ips;
}

// ---------- window ----------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    backgroundColor: '#070910',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  stopDiscovery();
  if (process.platform !== 'darwin') app.quit();
});
