// TallyWatch Manager — main process
// ----------------------------------
// Owns all device and network I/O so the renderer never makes cross-origin
// requests to beacons (no CORS to fight). Responsibilities:
//   - mDNS discovery of beacons (_tallywatch._tcp)
//   - HTTP calls to each beacon (status, label, identify, reboot, OTA push)
//   - GitHub release check + local firmware caching (the "courier" model: pull
//     when the laptop is online, push to beacons on the isolated show network)

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { Bonjour } = require('bonjour-service');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

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

// ---------- USB serial provisioning ----------
// Configure beacons over the wire before they're ever on WiFi. A beacon speaks a
// line-delimited JSON protocol over its native USB-CDC port (see handleSerial in
// the firmware). We open each candidate port, ping it, and keep the ones that
// answer with the tallywatch marker — so several beacons on one machine each show
// up as a distinct, identifiable row.

const usbPorts = new Map(); // path -> BeaconPort (kept open across a provisioning session)

// A single beacon's serial connection: line-in/line-out JSON with per-port
// command serialization (the firmware answers one line per command).
class BeaconPort {
  constructor(portPath) {
    this.path = portPath;
    this.port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
    this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\n' }));
    this.waiters = [];
    this.chain = Promise.resolve();
    this.parser.on('data', (line) => this._onLine(line));
    this.port.on('close', () => this._flush(new Error('port closed')));
    this.port.on('error', () => {}); // surfaced via request rejections
  }

  // node-serialport asserts DTR/RTS on open, which on the ESP32-C3's built-in
  // USB-JTAG bridge maps to EN/BOOT and can nudge the chip into a non-responsive
  // state. Drop both lines, then let it settle before we send anything.
  open() {
    return new Promise((resolve, reject) => {
      this.port.open((err) => {
        if (err) return reject(err);
        this.port.set({ dtr: false, rts: false }, () => setTimeout(resolve, 400));
      });
    });
  }

  _onLine(line) {
    const s = String(line).trim();
    if (!s) return;
    let obj;
    try { obj = JSON.parse(s); } catch { return; } // ignore any non-JSON noise
    // Match by the echoed cmd so a late/duplicate reply (e.g. from a retried
    // ping) can't resolve the wrong request. Fall back to FIFO if no cmd.
    let idx = obj.cmd ? this.waiters.findIndex((w) => w.cmd === obj.cmd) : 0;
    if (idx < 0) return; // orphan reply with no matching waiter — drop it
    const w = this.waiters.splice(idx, 1)[0];
    if (w) { clearTimeout(w.timer); w.resolve(obj); }
  }

  _flush(err) {
    while (this.waiters.length) { const w = this.waiters.shift(); clearTimeout(w.timer); w.reject(err); }
  }

  // One write + wait for the matching reply.
  _attempt(obj, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { resolve, reject, cmd: obj.cmd };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error('serial timeout'));
      }, timeoutMs);
      this.waiters.push(w);
      this.port.write(JSON.stringify(obj) + '\n', (err) => {
        if (err) { clearTimeout(w.timer); const i = this.waiters.indexOf(w); if (i >= 0) this.waiters.splice(i, 1); reject(err); }
      });
    });
  }

  // Serialized so overlapping IPC calls to the same port can't interleave lines.
  // Retries because the C3's USB-CDC occasionally drops a write; every command in
  // the protocol is idempotent, and cmd-matching in _onLine drops the duplicate
  // reply a retry may produce, so retrying is always safe.
  request(obj, timeoutMs = 1500, retries = 3) {
    const run = async () => {
      let lastErr;
      for (let i = 0; i < retries; i++) {
        try { return await this._attempt(obj, timeoutMs); } catch (e) { lastErr = e; }
      }
      throw lastErr;
    };
    // Run after the previous request settles either way; a rejection must not
    // poison the chain (that would silently drop every following request).
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => {});
    return result;
  }

  async close() {
    this._flush(new Error('closing'));
    await new Promise((res) => this.port.close(() => res()));
  }
}

// A port worth probing: the ESP32-C3 native-USB VID, or a classic USB-UART
// bridge / native-CDC device path. We still confirm with a ping before trusting it.
function looksLikeBeaconPort(p) {
  if ((p.vendorId || '').toLowerCase() === '303a') return true; // Espressif native USB
  return /usbmodem|usbserial|wchusbserial|ttyACM|ttyUSB/i.test(p.path || '');
}

async function getBeaconPort(portPath) {
  let bp = usbPorts.get(portPath);
  if (bp) return bp;
  bp = new BeaconPort(portPath);
  await bp.open();
  usbPorts.set(portPath, bp);
  return bp;
}

async function closeBeaconPort(portPath) {
  const bp = usbPorts.get(portPath);
  if (!bp) return;
  usbPorts.delete(portPath);
  try { await bp.close(); } catch {}
}

// Enumerate ports, ping each candidate, and return the beacons that answer. Ports
// that don't respond are closed again so we don't hog a non-beacon device.
async function usbScan() {
  const all = await SerialPort.list();
  const candidates = all.filter(looksLikeBeaconPort);
  const results = await Promise.all(candidates.map(async (p) => {
    try {
      const bp = await getBeaconPort(p.path);
      const res = await bp.request({ cmd: 'ping' });
      if (res && res.type === 'tallywatch') {
        return { path: p.path, id: res.id, fw: res.fw, name: res.name, label: res.label || '', vendorId: p.vendorId, productId: p.productId };
      }
      await closeBeaconPort(p.path); // answered but not one of ours
      return null;
    } catch {
      await closeBeaconPort(p.path); // no/failed response — release it
      return null;
    }
  }));
  return results.filter(Boolean);
}

async function usbGetConfig(portPath) {
  const bp = await getBeaconPort(portPath);
  const res = await bp.request({ cmd: 'getconfig' });
  return res.config || {};
}

async function usbGetAbout(portPath) {
  const bp = await getBeaconPort(portPath);
  const res = await bp.request({ cmd: 'getabout' });
  return res.about || {};
}

async function usbSave(portPath, config, reboot) {
  const bp = await getBeaconPort(portPath);
  const res = await bp.request({ cmd: 'save', config, reboot: !!reboot });
  if (!res.ok) throw new Error(res.error || 'save failed');
  if (reboot) await closeBeaconPort(portPath); // it re-enumerates after reboot
  return true;
}

async function usbLocate(portPath, on) {
  const bp = await getBeaconPort(portPath);
  const res = await bp.request({ cmd: 'locate', on: !!on });
  return !!res.ok;
}

async function usbReboot(portPath) {
  const bp = await getBeaconPort(portPath);
  await bp.request({ cmd: 'reboot' }).catch(() => {});
  await closeBeaconPort(portPath);
  return true;
}

async function usbCloseAll() {
  await Promise.all([...usbPorts.keys()].map(closeBeaconPort));
  return true;
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

  ipcMain.handle('usb:scan', () => usbScan());
  ipcMain.handle('usb:getConfig', (_e, p) => usbGetConfig(p));
  ipcMain.handle('usb:getAbout', (_e, p) => usbGetAbout(p));
  ipcMain.handle('usb:save', (_e, p, config, reboot) => usbSave(p, config, reboot));
  ipcMain.handle('usb:locate', (_e, p, on) => usbLocate(p, on));
  ipcMain.handle('usb:reboot', (_e, p) => usbReboot(p));
  ipcMain.handle('usb:closeAll', () => usbCloseAll());

  // Import/export a beacon config as a JSON file (the same schema getconfig/save
  // speak), for batch re-programming a fleet from one saved template.
  ipcMain.handle('config:export', async (_e, config, suggestedName) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export beacon config',
      defaultPath: suggestedName || 'tallywatch-config.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
    return true;
  });
  ipcMain.handle('config:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import beacon config',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePaths[0]) return null;
    return JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  });
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
  usbCloseAll();
  if (process.platform !== 'darwin') app.quit();
});
