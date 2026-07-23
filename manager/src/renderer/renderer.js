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
  pollAll(); // one status refresh on launch; after that it's manual (Rescan)

  // GitHub is the ceiling: quietly see if there's something newer than the bundle.
  backgroundGithubCheck();
}

async function rescan() {
  await API.discoverStop();
  await API.discoverStart();
  onDiscovery(await API.discoverList());
  await pollAll();
  toast('Rescanned.');
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
  const fresh = [];
  for (const b of list) {
    if (!state.beacons.has(b.ip)) fresh.push(b.ip);
    const existing = state.beacons.get(b.ip) || {};
    state.beacons.set(b.ip, { ...existing, ...b });
  }
  render();
  fresh.forEach(refreshOne); // pull status once when a beacon first appears
}

async function refreshOne(ip) {
  try {
    const s = await API.status(ip);
    state.beacons.set(ip, { ...state.beacons.get(ip), ...s, online: true });
  } catch {
    const b = state.beacons.get(ip);
    if (b) b.online = false;
  }
  render();
}

async function pollAll() {
  await Promise.all([...state.beacons.keys()].map(refreshOne));
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
function isOffSubnet(b) {
  return !!(state.adapter && b.ip && !sameSubnet(b.ip, state.adapter.address, state.adapter.netmask));
}
function maskToPrefix(mask) { return (ipToInt(mask).toString(2).match(/1/g) || []).length; }

function render() {
  const grid = document.getElementById('grid');

  // Preserve an in-progress name edit if a status refresh re-renders mid-type.
  const active = document.activeElement;
  let editState = null;
  if (active && active.classList && active.classList.contains('b-name')) {
    editState = { ip: active.dataset.ip, value: active.value, start: active.selectionStart, end: active.selectionEnd };
  }

  // Off-subnet beacons sort to the top and get loud treatment.
  const beacons = [...state.beacons.values()].sort((a, b) => {
    const oa = isOffSubnet(a), ob = isOffSubnet(b);
    if (oa !== ob) return oa ? -1 : 1;
    return (a.label || a.id || a.ip).localeCompare(b.label || b.id || b.ip);
  });

  document.getElementById('empty').style.display = beacons.length ? 'none' : 'block';
  renderFleetBar(beacons);
  renderAlertBar(beacons);

  const subnetLabel = state.adapter ? `${state.adapter.address}/${maskToPrefix(state.adapter.netmask)}` : 'your subnet';

  grid.innerHTML = '';
  for (const b of beacons) {
    const version = beaconVersion(b);
    const outOfDate = isOutOfDate(b);
    const offSubnet = isOffSubnet(b);
    const color = b.color && b.color !== '#000000' ? b.color : '#1a1e2b';

    const card = document.createElement('div');
    card.className = 'card' + (offSubnet ? ' alert' : '');
    card.innerHTML = `
      <div class="swatch" style="background:${escAttr(color)}"></div>
      <div class="b-main">
        <div class="b-name-row">
          <input class="b-name" data-ip="${escAttr(b.ip)}" data-orig="${escAttr(b.label || '')}"
            value="${escAttr(b.label || '')}" placeholder="Name this beacon" spellcheck="false">
          <button class="b-name-save" data-savename="${escAttr(b.ip)}" style="display:none">Save</button>
        </div>
        <p class="b-meta"><span>${escHtml(b.ip)}</span>
          <span>${b.dhcp === '0' ? 'static' : 'DHCP'}</span>
          <span>${escHtml(b.id || b.device_id || '')}</span>
          <span>up ${fmtUptime(b.uptime_s)}</span></p>
        <div class="badges">
          ${offSubnet ? `<span class="badge err">⚠ Off-subnet — not on ${escHtml(subnetLabel)}</span>` : ''}
          ${b.online === false
            ? `<span class="badge err">Unreachable</span>`
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
        <button class="btn ${offSubnet ? 'btn-primary' : 'btn-secondary'} btn-sm" data-ip="${escAttr(b.ip)}">Change IP</button>
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
  grid.querySelectorAll('[data-ip]').forEach((el) =>
    el.onclick = () => openIp(el.dataset.ip));
  grid.querySelectorAll('.b-name').forEach((el) =>
    el.oninput = () => { el.parentElement.querySelector('.b-name-save').style.display = el.value !== el.dataset.orig ? 'inline-block' : 'none'; });
  grid.querySelectorAll('[data-savename]').forEach((el) =>
    el.onclick = () => saveName(el.dataset.savename));

  if (editState) {
    const el = grid.querySelector(`.b-name[data-ip="${editState.ip}"]`);
    if (el) {
      el.value = editState.value;
      el.focus();
      try { el.setSelectionRange(editState.start, editState.end); } catch {}
      el.parentElement.querySelector('.b-name-save').style.display = el.value !== el.dataset.orig ? 'inline-block' : 'none';
    }
  }
}

function renderAlertBar(beacons) {
  const off = beacons.filter(isOffSubnet);
  const bar = document.getElementById('alert-bar');
  if (!off.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const ips = off.map((b) => escHtml(b.ip)).join(', ');
  bar.innerHTML = `⚠ ${off.length} beacon${off.length > 1 ? 's' : ''} ${off.length > 1 ? 'have' : 'has'} an IP outside your subnet (${ips}) — ${off.length > 1 ? 'they' : 'it'} may be unreachable. Use <b>Change IP</b> to fix.`;
}

async function saveName(ip) {
  const el = document.querySelector(`.b-name[data-ip="${ip}"]`);
  if (!el) return;
  const name = el.value.trim();
  try {
    await API.setLabel(ip, name);
    const b = state.beacons.get(ip); if (b) b.label = name;
    el.dataset.orig = name;
    el.parentElement.querySelector('.b-name-save').style.display = 'none';
    el.blur();
    toast('Name saved.');
  } catch (e) { toast('Save failed: ' + e.message, true); }
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
  document.getElementById('rescan-btn').onclick = rescan;
  document.getElementById('check-btn').onclick = checkUpdates;
  document.getElementById('settings-btn').onclick = openSettings;
  document.getElementById('s-save').onclick = saveSettings;
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
    { ip: '192.168.1.77', id: 'TallyWatch:AABBCCAA0011', fw: '1.0.0', label: 'Booth', companion_connected: false, wifi_rssi: -61, color: '#000000', uptime_s: 90, firmware_version: '1.0.0', dhcp: '0', static_ip: '192.168.1.77', static_gateway: '192.168.1.1', static_subnet: '255.255.255.0', static_dns: '192.168.1.1' },
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
