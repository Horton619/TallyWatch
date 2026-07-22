# Change Log

## Unreleased — WiFi update + fleet management

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
