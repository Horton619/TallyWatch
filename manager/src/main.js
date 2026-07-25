// TallyWatch Manager — main process
// ----------------------------------
// Owns all device and network I/O so the renderer never makes cross-origin
// requests to beacons (no CORS to fight). Responsibilities:
//   - mDNS discovery of beacons (_tallywatch._tcp)
//   - HTTP calls to each beacon (status, label, identify, reboot, OTA push)
//   - GitHub release check + local firmware caching (the "courier" model: pull
//     when the laptop is online, push to beacons on the isolated show network)

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
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

// ---------- firmware sources ----------
// The manager always has a floor: the firmware bundled into the app. GitHub is the
// ceiling: a background check can pull something newer. activeFirmware() is whichever
// is newest and has a usable .bin on disk.
function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

function bundledFirmware() {
  try {
    const dir = path.join(__dirname, '..', 'firmware');
    const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const binPath = path.join(dir, mf.file);
    return { version: mf.version, codename: mf.codename, path: binPath, available: fs.existsSync(binPath), source: 'bundled' };
  } catch {
    return null;
  }
}

let cachedGithub = null; // { version, path } newer firmware pulled from GitHub

function activeFirmware() {
  const b = bundledFirmware();
  if (cachedGithub && (!b || cmpVer(cachedGithub.version, b.version) > 0)) {
    return { ...cachedGithub, available: fs.existsSync(cachedGithub.path), source: 'github' };
  }
  return b;
}

async function githubCheck() {
  const s = loadSettings();
  const headers = { 'User-Agent': 'TallyWatch-Manager', Accept: 'application/vnd.github+json' };
  if (s.githubToken) headers.Authorization = `Bearer ${s.githubToken}`;

  const api = `https://api.github.com/repos/${s.githubOwner}/${s.githubRepo}/releases/latest`;
  const r = await fetchWithTimeout(api, { headers }, 8000);
  if (!r.ok) throw new Error(`GitHub ${r.status} — ${r.status === 404 ? 'no releases yet, or private repo needs a token' : 'check owner/repo/token'}`);
  const rel = await r.json();

  const version = (rel.tag_name || '').replace(/^v/, '');
  const bundled = bundledFirmware();
  const newer = !bundled || cmpVer(version, bundled.version) > 0;

  if (newer) {
    const asset = (rel.assets || []).find((a) => a.name.endsWith('.bin'));
    if (!asset) throw new Error('Release has no .bin asset');
    fs.mkdirSync(CACHE_DIR(), { recursive: true });
    const dest = path.join(CACHE_DIR(), asset.name);
    if (!fs.existsSync(dest)) {
      const dl = await fetchWithTimeout(asset.url, { headers: { ...headers, Accept: 'application/octet-stream' } }, 30000);
      if (!dl.ok) throw new Error('Download failed ' + dl.status);
      fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
    }
    cachedGithub = { version, path: dest };
  }

  return { version, newer, active: activeFirmware() };
}

async function pushFirmware(ip) {
  const fw = activeFirmware();
  if (!fw || !fw.available) {
    throw new Error('No firmware .bin available — run manager/tools/bundle-firmware.sh, or Check GitHub while online');
  }
  const buf = fs.readFileSync(fw.path);
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
  ipcMain.handle('beacon:setIp', (_e, ip, cfg) => {
    const q = new URLSearchParams(cfg).toString();
    return fetchWithTimeout(`http://${ip}/setip?${q}`, { method: 'POST' }, 6000).then((r) => r.ok);
  });
  ipcMain.handle('beacon:push', (_e, ip) => pushFirmware(ip));
  ipcMain.handle('beacon:openSetup', (_e, ip) => { shell.openExternal(`http://${ip}/`); return true; });

  ipcMain.handle('firmware:active', () => {
    const fw = activeFirmware();
    return fw ? { version: fw.version, codename: fw.codename, source: fw.source, available: fw.available } : null;
  });
  ipcMain.handle('github:check', () => githubCheck());

  ipcMain.handle('settings:get', () => loadSettings());
  ipcMain.handle('settings:set', (_e, s) => { saveSettings(s); return true; });
  ipcMain.handle('sys:adapters', () => hostAdapters());
  ipcMain.handle('net:ipInUse', (_e, ip) => ipInUse(ip));
}

// The laptop's usable IPv4 adapters, with netmask — the manager derives beacon
// subnet/gateway from the selected one so the user only ever types an IP.
function hostAdapters() {
  const ifaces = os.networkInterfaces();
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) {
        out.push({ name, address: i.address, netmask: i.netmask, cidr: i.cidr });
      }
    }
  }
  return out;
}

// Best-effort "is this IP occupied" check via the system ping. A reply means
// occupied; no reply is inconclusive (host may just not answer ICMP), so callers
// treat a positive as a warning, not a hard block.
function ipInUse(ip) {
  return new Promise((resolve) => {
    let args;
    if (process.platform === 'win32') args = ['-n', '1', '-w', '700', ip];
    else if (process.platform === 'darwin') args = ['-c', '1', '-W', '1000', ip];
    else args = ['-c', '1', '-W', '1', ip];
    execFile('ping', args, { timeout: 2500 }, (err) => resolve(!err));
  });
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
