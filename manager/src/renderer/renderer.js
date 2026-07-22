// TallyWatch Manager — renderer
// Talks only to the preload-exposed `window.tallywatch` API. When that's absent
// (opened directly in a browser for design preview), a mock stands in.

const API = window.tallywatch || makeMock();

const state = {
  beacons: new Map(),  // ip -> { ip, id, fw, ...status }
  latest: null,        // { version, asset } from GitHub
  renameIp: null,
};

// ---------- lifecycle ----------
async function boot() {
  wireUi();
  await loadAdapters();

  // Baseline is known immediately from the firmware bundled into the app — no click,
  // works offline. Beacons compare against this the moment they're discovered.
  const active = await API.firmwareActive();
  if (active) { state.latest = active; renderFwPill(); }

  API.onBeaconsUpdated(onDiscovery);
  await API.discoverStart();
  onDiscovery(await API.discoverList());
  setInterval(pollAll, 3000);
  pollAll();

  // GitHub is the ceiling: quietly see if there's something newer than the bundle.
  backgroundGithubCheck();
}

async function backgroundGithubCheck() {
  try {
    const r = await API.githubCheck();
    if (r && r.newer) {
      state.latest = r.active;
      renderFwPill(); render();
      toast(`Newer firmware v${r.version} found on GitHub and cached.`);
    }
  } catch {
    // offline or no releases — the bundled firmware stays the baseline, silently
  }
}

function onDiscovery(list) {
  for (const b of list) {
    const existing = state.beacons.get(b.ip) || {};
    state.beacons.set(b.ip, { ...existing, ...b });
  }
  render();
}

async function pollAll() {
  const ips = [...state.beacons.keys()];
  await Promise.all(ips.map(async (ip) => {
    try {
      const s = await API.status(ip);
      state.beacons.set(ip, { ...state.beacons.get(ip), ...s, online: true });
    } catch {
      const b = state.beacons.get(ip);
      if (b) b.online = false;
    }
  }));
  render();
}

// ---------- rendering ----------
function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

function fmtUptime(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function signalLabel(rssi) {
  if (rssi == null) return '—';
  if (rssi > -60) return 'strong';
  if (rssi > -75) return 'ok';
  return 'weak';
}

function beaconVersion(b) { return b.firmware_version || b.fw || ''; }
function isOutOfDate(b) {
  const v = beaconVersion(b);
  return !!(state.latest && v && cmpVersion(v, state.latest.version) < 0);
}

function render() {
  const grid = document.getElementById('grid');
  const beacons = [...state.beacons.values()].sort((a, b) =>
    (a.label || a.id || a.ip).localeCompare(b.label || b.id || b.ip));

  document.getElementById('empty').style.display = beacons.length ? 'none' : 'block';
  renderFleetBar(beacons);

  grid.innerHTML = '';
  for (const b of beacons) {
    const version = beaconVersion(b);
    const outOfDate = isOutOfDate(b);
    const color = b.color && b.color !== '#000000' ? b.color : '#1a1e2b';

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="swatch" style="background:${escAttr(color)}"></div>
      <div class="b-main">
        <p class="b-label">${escHtml(b.label || 'Unnamed beacon')}
          <span class="edit" data-rename="${escAttr(b.ip)}">rename</span>
          <span class="edit" data-ip="${escAttr(b.ip)}">network</span></p>
        <p class="b-meta"><span>${escHtml(b.ip)}</span>
          <span>${b.dhcp === '0' ? 'static' : 'DHCP'}</span>
          <span>${escHtml(b.id || b.device_id || '')}</span>
          <span>up ${fmtUptime(b.uptime_s)}</span></p>
        <div class="badges">
          ${b.online === false
            ? `<span class="badge err">Offline</span>`
            : b.companion_connected
              ? `<span class="badge ok">Live · Companion</span>`
              : `<span class="badge warn">Waiting on Companion</span>`}
          <span class="badge info">WiFi ${signalLabel(b.wifi_rssi)}</span>
          ${version ? (outOfDate
              ? `<span class="badge warn">v${escHtml(version)} → v${escHtml(state.latest.version)}</span>`
              : `<span class="badge ok">v${escHtml(version)}</span>`) : ''}
        </div>
      </div>
      <div class="b-actions">
        <button class="btn btn-secondary btn-sm" data-identify="${escAttr(b.ip)}">Identify</button>
        ${updateButton(b, version, outOfDate)}
        <button class="btn btn-secondary btn-sm" data-reboot="${escAttr(b.ip)}">Reboot</button>
      </div>`;
    grid.appendChild(card);
  }

  grid.querySelectorAll('[data-identify]').forEach((el) =>
    el.onclick = () => act(el.dataset.identify, 'identify', 'Identifying — watch for the flashing light.'));
  grid.querySelectorAll('[data-reboot]').forEach((el) =>
    el.onclick = () => act(el.dataset.reboot, 'reboot', 'Reboot sent.'));
  grid.querySelectorAll('[data-update]').forEach((el) =>
    el.onclick = () => pushUpdate(el.dataset.update));
  grid.querySelectorAll('[data-rename]').forEach((el) =>
    el.onclick = () => openRename(el.dataset.rename));
  grid.querySelectorAll('[data-ip]').forEach((el) =>
    el.onclick = () => openIp(el.dataset.ip));
}

function updateButton(b, version, outOfDate) {
  if (!state.latest || !version) {
    return `<button class="btn btn-secondary btn-sm" disabled>Update</button>`;
  }
  if (outOfDate) {
    return `<button class="btn btn-primary btn-sm" data-update="${escAttr(b.ip)}">Update → v${escHtml(state.latest.version)}</button>`;
  }
  return `<button class="btn btn-secondary btn-sm" disabled>✓ Latest</button>`;
}

function renderFleetBar(beacons) {
  const bar = document.getElementById('fleet-bar');
  const btn = document.getElementById('update-all-btn');
  const summary = document.getElementById('fleet-summary');
  if (!beacons.length || !state.latest) { bar.style.display = 'none'; return; }

  const outdated = beacons.filter(isOutOfDate);
  bar.style.display = 'flex';
  if (outdated.length === 0) {
    summary.innerHTML = `<span class="ok-txt">✓ All ${beacons.length} beacon${beacons.length > 1 ? 's' : ''} on v${escHtml(state.latest.version)}</span>`;
    btn.style.display = 'none';
  } else {
    summary.innerHTML = `<span class="warn-txt">${outdated.length} of ${beacons.length} need v${escHtml(state.latest.version)}</span>`;
    btn.style.display = 'inline-block';
    btn.textContent = `Update all (${outdated.length})`;
    btn.onclick = updateAll;
  }
}

async function updateAll() {
  const outdated = [...state.beacons.values()].filter(isOutOfDate);
  if (!outdated.length) return;
  const btn = document.getElementById('update-all-btn');
  btn.disabled = true;
  let done = 0;
  for (const b of outdated) {
    btn.textContent = `Updating ${++done}/${outdated.length}…`;
    try { await API.push(b.ip); } catch {}
  }
  btn.disabled = false;
  toast(`Pushed firmware to ${outdated.length} beacon${outdated.length > 1 ? 's' : ''} — they're rebooting.`);
}

function renderFwPill() {
  const pill = document.getElementById('fw-pill');
  if (!state.latest) { pill.textContent = 'Firmware: —'; return; }
  const src = state.latest.source === 'github' ? 'GitHub' : 'bundled';
  pill.innerHTML = `Firmware <b>v${escHtml(state.latest.version)}</b> · ${src}`;
}

// ---------- actions ----------
async function act(ip, fn, okMsg) {
  try { await API[fn](ip); toast(okMsg); } catch (e) { toast('Failed: ' + e.message, true); }
}

async function pushUpdate(ip) {
  if (!state.latest) { toast('Check for updates first (while online).', true); return; }
  toast('Pushing firmware…');
  try {
    const r = await API.push(ip);
    toast(r.ok ? 'Update sent — beacon rebooting.' : 'Update failed: ' + (r.text || ''), !r.ok);
  } catch (e) { toast('Push failed: ' + e.message, true); }
}

async function checkUpdates() {
  const btn = document.getElementById('check-btn');
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await API.githubCheck();
    if (r.active) { state.latest = r.active; renderFwPill(); render(); }
    toast(r.newer
      ? `Newer firmware v${r.version} found and cached.`
      : `Already on the latest (v${r.version}).`);
  } catch (e) {
    toast('GitHub check failed: ' + e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = 'Check GitHub';
  }
}

async function loadAdapters() {
  try {
    state.adapters = (await API.adapters()) || [];
  } catch { state.adapters = []; }
  const sel = document.getElementById('adapter-select');
  sel.innerHTML = '';
  state.adapters.forEach((a, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = `${a.name} · ${a.cidr || a.address}`;
    sel.appendChild(o);
  });
  sel.onchange = () => { state.adapter = state.adapters[+sel.value] || null; renderNetbar(); };
  state.adapter = state.adapters[0] || null;
  renderNetbar();
}

function renderNetbar() {
  const info = document.getElementById('adapter-info');
  if (!state.adapter) { info.textContent = 'no network detected'; return; }
  const a = state.adapter;
  info.innerHTML = `IP <b style="color:var(--text)">${escHtml(a.address)}</b> · subnet ${escHtml(a.netmask)} — beacons share this subnet`;
}

// ---------- IPv4 helpers ----------
function ipToInt(ip) { return ip.split('.').reduce((acc, o) => (acc * 256) + (+o), 0) >>> 0; }
function intToIp(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
function isValidIp(s) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s || '')) return false;
  return s.split('.').every((o) => +o >= 0 && +o <= 255);
}
function sameSubnet(a, b, mask) { return (ipToInt(a) & ipToInt(mask)) === (ipToInt(b) & ipToInt(mask)); }
// Derive a sensible gateway (network base + 1) — beacons only talk on-subnet, so
// this only needs to be plausible for WiFi.config, never actually routed.
function deriveGateway(ip, mask) { return intToIp(((ipToInt(ip) & ipToInt(mask)) + 1) >>> 0); }

// ---------- modals ----------
function wireUi() {
  document.getElementById('rescan-btn').onclick = async () => { await API.discoverStop(); await API.discoverStart(); toast('Rescanning…'); };
  document.getElementById('check-btn').onclick = checkUpdates;
  document.getElementById('settings-btn').onclick = openSettings;
  document.getElementById('s-save').onclick = saveSettings;
  document.getElementById('rename-save').onclick = saveRename;
  document.getElementById('ip-save').onclick = saveIp;
  document.getElementById('ip-dhcp').onchange = toggleIpFields;
  document.getElementById('warn-fix').onclick = hideWarn; // back to the IP modal to edit
}

async function openSettings() {
  const s = await API.getSettings();
  document.getElementById('s-owner').value = s.githubOwner || '';
  document.getElementById('s-repo').value = s.githubRepo || '';
  document.getElementById('s-token').value = s.githubToken || '';
  showModal('settings-modal');
}
async function saveSettings() {
  await API.setSettings({
    githubOwner: document.getElementById('s-owner').value.trim(),
    githubRepo: document.getElementById('s-repo').value.trim(),
    githubToken: document.getElementById('s-token').value.trim(),
  });
  closeModals(); toast('Saved.');
}

function openRename(ip) {
  state.renameIp = ip;
  const b = state.beacons.get(ip);
  document.getElementById('rename-input').value = b?.label || '';
  showModal('rename-modal');
}
async function saveRename() {
  const name = document.getElementById('rename-input').value.trim();
  try {
    await API.setLabel(state.renameIp, name);
    const b = state.beacons.get(state.renameIp); if (b) b.label = name;
    render(); closeModals(); toast('Renamed.');
  } catch (e) { toast('Rename failed: ' + e.message, true); }
}

function openIp(ip) {
  state.ipIp = ip;
  const b = state.beacons.get(ip) || {};
  document.getElementById('ip-modal-name').textContent = b.label || ip;
  document.getElementById('ip-dhcp').checked = b.dhcp !== '0';
  document.getElementById('ip-addr').value = b.static_ip || (b.dhcp === '0' ? b.ip : '') || '';
  hideIpError();
  toggleIpFields();
  showModal('ip-modal');
}

function toggleIpFields() {
  const on = document.getElementById('ip-dhcp').checked;
  const box = document.getElementById('ip-static-fields');
  box.style.opacity = on ? '0.4' : '1';
  box.style.pointerEvents = on ? 'none' : 'auto';
  const d = document.getElementById('ip-derived');
  d.textContent = state.adapter && !on
    ? `Subnet ${state.adapter.netmask} and gateway ${deriveGateway(state.adapter.address, state.adapter.netmask)} come from ${state.adapter.name}.`
    : '';
}

function showIpError(msg) { const e = document.getElementById('ip-error'); e.textContent = msg; e.style.display = 'block'; }
function hideIpError() { document.getElementById('ip-error').style.display = 'none'; }

async function saveIp() {
  hideIpError();
  const dhcp = document.getElementById('ip-dhcp').checked ? '1' : '0';
  if (dhcp === '1') { return doSetIp({ dhcp: '1' }); }

  const ip = document.getElementById('ip-addr').value.trim();

  // Hard validation — must fix, no override.
  if (!isValidIp(ip)) { showIpError('That is not a valid IPv4 address (e.g. 10.0.0.20).'); return; }
  if (!state.adapter) { showIpError('No network adapter selected.'); return; }

  const mask = state.adapter.netmask;
  const cfg = { dhcp: '0', ip, subnet: mask, gateway: deriveGateway(ip, mask), dns: deriveGateway(ip, mask) };

  // Soft warnings — the user can choose to proceed.
  const warns = [];
  if (!sameSubnet(ip, state.adapter.address, mask)) {
    warns.push(`<b>${escHtml(ip)}</b> is not on this computer's subnet (${escHtml(state.adapter.address)} / ${escHtml(mask)}). After it reboots you may not be able to reach the beacon.`);
  }
  const selfCur = state.beacons.get(state.ipIp)?.ip;
  const clash = [...state.beacons.values()].find((b) => b.ip === ip && b.ip !== selfCur);
  if (clash) {
    warns.push(`<b>${escHtml(ip)}</b> is already used by "${escHtml(clash.label || clash.ip)}".`);
  } else if (ip !== selfCur) {
    try { if (await API.ipInUse(ip)) warns.push(`<b>${escHtml(ip)}</b> answered a ping — another device may already be using it.`); } catch {}
  }

  if (warns.length) { showWarn(warns, () => doSetIp(cfg)); return; }
  doSetIp(cfg);
}

async function doSetIp(cfg) {
  try {
    await API.setIp(state.ipIp, cfg);
    state.beacons.delete(state.ipIp); // reboots at a new address; discovery re-adds it
    render(); closeModals();
    toast('Network saved — beacon rebooting, it will reappear shortly.');
  } catch (e) { toast('Failed: ' + e.message, true); }
}

// ---------- warn popup (Fix / Continue) ----------
function showWarn(messages, onContinue) {
  document.getElementById('warn-body').innerHTML = messages.map((m) => `<p style="margin:0 0 8px">⚠ ${m}</p>`).join('');
  document.getElementById('warn-continue').onclick = () => { hideWarn(); onContinue(); };
  document.getElementById('warn-modal').style.display = 'block';
}
function hideWarn() { document.getElementById('warn-modal').style.display = 'none'; }

function showModal(id) {
  document.getElementById('overlay').style.display = 'block';
  document.getElementById(id).style.display = 'block';
}
function closeModals(e) {
  if (e && e.target && e.target.id !== 'overlay') return;
  document.getElementById('overlay').style.display = 'none';
  document.querySelectorAll('.modal').forEach((m) => m.style.display = 'none');
}

// ---------- utils ----------
let toastT;
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3000);
}
function escHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(s) { return escHtml(s); }

// ---------- browser-preview mock ----------
function makeMock() {
  const beacons = [
    { ip: '10.0.0.21', id: 'TallyWatch:AABBCC112233', fw: '1.0.0', label: 'Camera 1', companion_connected: true, wifi_rssi: -52, color: '#ef4444', uptime_s: 8400, firmware_version: '1.0.0', dhcp: '0', static_ip: '10.0.0.21', static_gateway: '10.0.0.1', static_subnet: '255.255.255.0', static_dns: '10.0.0.1' },
    { ip: '10.0.0.22', id: 'TallyWatch:AABBCC445566', fw: '1.0.0', label: 'FOH Laptop', companion_connected: false, wifi_rssi: -68, color: '#000000', uptime_s: 320, firmware_version: '1.0.0', dhcp: '0', static_ip: '10.0.0.22', static_gateway: '10.0.0.1', static_subnet: '255.255.255.0', static_dns: '10.0.0.1' },
    { ip: '10.0.0.23', id: 'TallyWatch:AABBCC778899', fw: '0.9.0', label: 'Stage Right', companion_connected: true, wifi_rssi: -80, color: '#22c55e', uptime_s: 15100, firmware_version: '0.9.0', dhcp: '0', static_ip: '10.0.0.23', static_gateway: '10.0.0.1', static_subnet: '255.255.255.0', static_dns: '10.0.0.1' },
  ];
  let cb = () => {};
  return {
    onBeaconsUpdated: (fn) => { cb = fn; },
    discoverStart: async () => { setTimeout(() => cb(beacons), 150); return true; },
    discoverStop: async () => true,
    discoverList: async () => beacons,
    status: async (ip) => { const b = beacons.find((x) => x.ip === ip); if (!b) throw new Error('gone'); return { ...b, device_id: b.id }; },
    identify: async () => true,
    reboot: async () => true,
    setLabel: async () => true,
    setIp: async () => true,
    push: async () => ({ ok: true, text: 'OK - rebooting' }),
    firmwareActive: async () => ({ version: '1.0.0', codename: 'First Light', source: 'bundled', available: true }),
    githubCheck: async () => ({ version: '1.0.0', newer: false, active: { version: '1.0.0', source: 'bundled', available: true } }),
    getSettings: async () => ({ githubOwner: 'Horton619', githubRepo: 'TallyWatch', githubToken: '' }),
    setSettings: async () => true,
    adapters: async () => ([
      { name: 'en0', address: '10.0.0.5', netmask: '255.255.255.0', cidr: '10.0.0.5/24' },
      { name: 'en1 (Wi-Fi)', address: '192.168.1.10', netmask: '255.255.255.0', cidr: '192.168.1.10/24' },
    ]),
    ipInUse: async (ip) => ip === '10.0.0.99',
  };
}

boot();
