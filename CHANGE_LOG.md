# Change Log

## Unreleased — WiFi update + fleet management

- **USB provisioning in Lightkeeper** — configure a beacon over its USB cable
  before it's ever on WiFi (solves the chicken-and-egg where a network-only
  manager can't reach an unconfigured beacon). New **USB Setup** panel scans for
  plugged-in beacons and lists each one; **hovering a row flashes that beacon's
  pixel red** so you can tell which physical unit you're about to edit when
  several are plugged into one machine. Clicking a row opens a full config editor
  mirroring the setup page (name, 3 WiFi networks, DHCP/static IP, Companion
  IP/port, indicators, Ultra Bright) with **Import/Export** of the same JSON the
  web page uses — for batch re-programming a fleet from one saved template.
  - Firmware: a line-delimited JSON command protocol over the native USB-CDC port
    (`ping`/`getconfig`/`getabout`/`save`/`locate`/`reboot`), pumped from every
    loop (normal, WiFi-connect, setup mode) so it answers regardless of network
    state. `connectWiFi()` no longer reboots when no saved network is reachable —
    that used to drop the USB port every ~24 s and made bench provisioning
    impossible. A `locate` command holds the pixel solid red (hover-to-identify).
  - Manager: node `serialport` (N-API prebuilds, so no native rebuild on the
    Windows CI). Robust framing — per-port command serialization, reply matching
    by echoed `cmd`, and retries (the C3's USB-CDC occasionally drops a write;
    every command is idempotent so retrying is safe). Verified on hardware:
    10× full ping→getconfig→save→verify→locate round-trips, zero failures.
- **Manager renamed "Lightkeeper"** with an emerald-lighthouse app icon
  (`manager/build/icon.svg`/`.png`) — the guiding light that tends the fleet.
  Product name, app id, window title, and docs updated.
- **Windows installer pipeline** — `.github/workflows/release-manager.yml` builds
  a signed-later NSIS `.exe` on a `manager-v*` tag and attaches it to a Release,
  so show machines install Lightkeeper by double-click (no Node/git/terminal).
- **First beacon validated end-to-end on hardware (2026-07-24).** A beacon
  assembled (ESP32-C3 Super Mini + 9 mm WS2812B pixel, powered from USB-C with a
  series silicon diode dropping 5 V→~4.3 V), flashed over USB, joined WiFi,
  registered with Bitfocus Companion as a Satellite surface, and mirrored a
  button's background color onto the LED. The whole chain works: solder →
  firmware → WiFi → Satellite protocol → Companion → LED.
- **Manager: "Configure" button** opens a beacon's live setup page at
  `http://<ip>/` in the browser. Because the firmware serves its full
  setup/Companion page during *normal* operation (not just setup mode), no
  BOOT-into-AP dance is needed once a beacon is on the network. Ran the Electron
  manager for the first time.
- **Bridge mode is now the default base-station setup** — mAP lite as a plain access
  point, beacons on static IPs on the production LAN alongside the Companion laptop, so
  the manager runs on that laptop (no "join the tally WiFi"). NAT kept as an isolation
  alternative. Added importable `docs/maplite-bridge.rsc` / `maplite-nat.rsc`.
- **Manager manages beacon IPs** — per-beacon Network editor (DHCP/static) via a new
  firmware `/setip` endpoint; `/status` now reports the beacon's IP config.
- **IP editor made foolproof** — a network segment with an **adapter dropdown** shows
  the computer's IP/subnet; the user only types an **IP address** (subnet + gateway are
  auto-derived from the selected adapter). Invalid IPv4 is a hard block; a
  wrong-subnet or ping-answered (in-use) address raises a **Fix / Continue** warning.


- **Firmware OTA over WiFi** — beacons run their web server + advertise over mDNS
  during normal operation (not just setup mode); added `/update/firmware` (self-flash
  via `Update.h`), `/status`, `/setlabel`, `/identify` endpoints and a friendly
  device label.
- **Setup page** — new Firmware section with a `.bin` upload (real XHR progress bar)
  and a Device Name field.
- **TallyWatch Manager** (`manager/`) — Electron app: mDNS discovery, live dashboard,
  identify (locate a beacon by flashing its LED), rename, and firmware push.
- **Zero-click firmware awareness** — the manager bundles a known-good firmware (the
  floor) via `manager/tools/bundle-firmware.sh`, so on launch it flags out-of-date
  beacons with no clicks: a fleet summary + one-click "Update all", per-beacon "✓
  Latest" / "Update → vX". GitHub is the ceiling: a background check prefers a newer
  release when the laptop is online (courier model for isolated show networks).
- **CI** — `.github/workflows/release-firmware.yml` builds the `.bin` on `v*` tags and
  attaches it to a GitHub Release; stamps the firmware version from the tag.
- Flash usage 82% (from 79%) — mDNS + OTA + endpoints; still within the OTA partition.

## V1.0.0 - "First Light"

Initial TallyWatch build — modernization pass over the earlier `DIYTallyLight.ino`
prototype into a named, VEP-branded product.

- Replaced WiFiManager's generic captive portal with a custom-built, VEP dark-themed
  setup web page (`web/index.html`), embedded gzip-compressed directly in firmware —
  no separate filesystem image/upload step.
- Added saved WiFi networks (up to 3, priority order, two-step delete confirm in the
  UI) — previously single-network only via WiFiManager.
- Added static IP / DHCP toggle.
- Added JSON config import/export.
- Added per-indicator on/off toggles (WiFi/Companion/Setup) and an Ultra Bright mode
  for the live mirrored color.
- Dropped the WiFiManager dependency; WiFi STA connect logic is now hand-rolled to
  support the multi-network/static-IP feature set above.
- Rebranded: `DIYTallyLight` → `TallyWatch`, AP SSID `TallyLight-Setup` →
  `TallyWatch-Setup`, Companion `PRODUCT_NAME` → `TallyWatch`, device ID prefix
  `diytally:` → `TallyWatch:`.
- UI/UX + copy pass: state-aware menu rows (Network/Companion surface their own
  status), attention-cascade Save button, hero entrance animation (reduced-motion
  aware), monoline SVG icons replacing emoji, and a two-step "Discard & exit".
- Set `LED_PIN` to GPIO3 (off the C3 strapping pins) to match the real
  Super Mini + WS2812B build; documented the 3V3-power data-level fix.
- Added `tools/flash.sh` + `tools/setup-toolchain.sh` for no-IDE batch flashing,
  a `BUILD.md` physical assembly/deploy guide, and `docs/V2_BATTERY.md` (parked
  battery-variant spec + shopping list).

Not yet verified on physical hardware — compile and end-to-end (WiFi, Companion
handshake, LED behavior) testing is the next step.
