# TallyWatch

*Visual Entropy Productions*

A live-event tally light for Bitfocus Companion. An ESP32-C3 registers itself with
Companion over the Satellite TCP protocol as a 1-button virtual surface, then mirrors
whatever background color Companion assigns to that button onto an addressable RGB
LED — so graphics operators can see at a glance which laptop is live to screen. Runs
inside a 3D-printed enclosure; configured over its own WiFi setup page.

## What this is (and isn't)

This is a from-scratch firmware written against Bitfocus's publicly documented
[Satellite API](https://companion.free/for-developers/Satellite-API) — it doesn't use
or contain any of the code, enclosure design, or branding of any commercial tally
product. It's built for personal/production use, not for resale.

## How the color sync works

The firmware registers a single virtual key with Companion (`KEYS_TOTAL=1`) and does
**not** need to know which button to watch — Companion's own Surfaces settings UI
decides that, the same mechanism used to pin a physical Stream Deck to a page:

1. Flash and power up the device, connect it to WiFi and point it at your Companion
   PC's IP (see Setup below).
2. In the Companion GUI, open the **Surfaces** tab. A device called "TallyWatch" will
   appear once the ESP32 connects.
3. Click its **Settings**, then set:
   - **Current Page** — the page number (starts at 1)
   - **Horizontal Offset** — the button's row (starts at 0)
   - **Vertical Offset** — the button's column (starts at 0)
4. The LED immediately starts mirroring that button's background color.

Requires **Companion 3.0.0+** and Companion's network interface setting set to "All
Interfaces" (or a network this device can reach) — otherwise the device sits there
breathing red forever, unable to open the socket.

## Hardware

| Part | Notes |
|---|---|
| ESP32-C3 "Super Mini" board | WiFi + BLE, single-core RISC-V |
| WS2812/SK6812 addressable RGB LED | 1 for status light |
| USB-C cable | for power |
| 3D-printed enclosure | diffuses the LED, houses the board |

Wiring: LED data (DIN) → GPIO3 (`LED_PIN` in `TallyWatch.ino`), LED VCC → **3V3** (see
the WS2812B note below), LED GND → GND. No external button needed — the board's
onboard BOOT button (GPIO9) doubles as the setup/reset button. Full step-by-step in
[BUILD.md](BUILD.md).

> **WS2812B data-level note:** the pixel wants a ~3.5 V data "high" at 5 V, but the C3
> only drives 3.3 V. Powering the pixel from **3V3** makes a single pixel reliable. For
> maximum brightness instead, power it from 5 V through a series Schottky diode (~4.5 V).

## Firmware setup

**Arduino IDE:**
1. Install the **esp32** board package (Espressif Systems) via Boards Manager.
2. Board: "ESP32C3 Dev Module" (or your specific variant).
3. Set "USB CDC On Boot" to Enabled (needed for Serial on most Super Mini boards).
4. Install libraries via Library Manager: **Adafruit NeoPixel** and **ArduinoJson**
   (v7.x). WiFiManager is *not* used — TallyWatch hosts its own setup web page.
5. Build the embedded setup page once (or after any edit to `web/index.html`):
   ```sh
   node tools/build-page.js
   ```
   This writes `firmware/page_html_gz.h` (gzip byte array), which `TallyWatch.ino`
   includes directly — no separate filesystem upload needed.
6. Open `TallyWatch.ino` and upload.

**First boot:**
1. Power up with no saved WiFi networks — it goes straight into setup mode: an access
   point named `TallyWatch-Setup` (password `tally1234`).
2. Connect a phone/laptop to it and browse to `192.168.4.1`.
3. Open **Network**, add your WiFi (scanned or manual), optionally set static IP.
   Open **Companion** and set your Companion PC's IP and Satellite TCP port (default
   `16622`). Hit **Save Settings** — it persists, reboots, and connects.
4. Finish the Companion-side setup above (Surfaces tab → set page/row/column).

**Reconfigure later:** hold BOOT for 3–7 seconds until the LED breathes green, then
release — reopens the setup AP at any time.

**Factory reset:** hold BOOT past 7 seconds until the LED flashes white, then release
— wipes all saved settings. The device's identity (`SERIAL`) is derived from its MAC
address and stays stable across resets/reflashes, so Companion re-recognizes it and
keeps the page/row/column assignment.

## Setup page features

- **Network** — WiFi scan + manual add, up to 3 saved networks (tried in priority
  order on boot, each with a two-step delete confirm), DHCP or static IPv4.
- **Companion** — PC IP address and Satellite TCP port.
- **Device** — per-indicator on/off toggles for the physical LED status language, and
  an Ultra Bright mode that raises the LED's brightness ceiling while mirroring a live
  Companion color.
- **Import/Export** — download or restore the full settings as a `.json` file.
- **About** — device ID, firmware version/codename, serial number, MAC, hardware
  version.

## Status LED reference

| Pattern | Meaning |
|---|---|
| Breathing blue | Connecting to WiFi |
| Breathing red | WiFi connected, connecting to Companion |
| Breathing green | Setup mode active |
| Solid white flash | Factory reset confirmed |
| Solid color | Normal operation — mirroring the assigned button |

Each of the blue/red/green indicators can be individually disabled from **Device**
settings; when off, the LED just stays dark for that state instead of breathing.

## Updating firmware over WiFi

Beacons run a small web server and advertise themselves over mDNS during normal
operation, so you can update them without USB:

- **Per beacon:** open the beacon's **Firmware** page and upload a `.bin` — it flashes
  itself and reboots.
- **Fleet:** the [TallyWatch Manager](manager/) desktop app discovers all beacons,
  shows their live status, and pushes firmware to them. It pulls releases from GitHub
  when your laptop is online and caches them, so it works on isolated show networks.

Firmware releases are built by CI (`.github/workflows/release-firmware.yml`) — push a
`vX.Y.Z` tag and the `.bin` is attached to a GitHub Release.

## Provisioning a beacon over USB

Before a beacon is on WiFi, configure it over its USB cable from Lightkeeper:
**USB Setup → Scan**, then hover a row to flash that beacon's pixel **red** (so you
can tell which physical unit you're editing when several are plugged in) and click it
to open the full config editor. Import/Export uses the same JSON as the web setup
page, so one saved config can batch-program a whole fleet.

## Releasing

Two independent release pipelines, each triggered by a tag:

| Tag pattern | Workflow | Builds | Consumed by |
|---|---|---|---|
| `vX.Y.Z` (e.g. `v1.0.1`) | `release-firmware.yml` | ESP32 `.bin` (version stamped from the tag) | Lightkeeper's OTA / update check |
| `manager-vX.Y.Z` | `release-manager.yml` | Windows `.exe` + signed/notarized macOS `.dmg` | People installing Lightkeeper |

```sh
# firmware
git tag v1.0.1 && git push origin v1.0.1
# desktop app (bump manager/package.json "version" first — the .dmg/.exe name
# comes from it, not the tag)
git tag manager-v1.1.0 && git push origin manager-v1.1.0
```

Both firmware build paths (CI, `manager/tools/bundle-firmware.sh`) and `tools/flash.sh`
compile with the `esp32:esp32:esp32c3:CDCOnBoot=cdc` FQBN — the `CDCOnBoot=cdc` flag is
compile-time and is what routes `Serial` to the native USB port, so USB provisioning
works on every build.

**macOS signing** reuses the VEP Developer ID (team `L5KZ5KGKXC`) via five repo Actions
secrets: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`. `serialport` is a native module but ships N-API prebuilds, so the build
config sets `npmRebuild: false` — electron-builder packages the prebuilt binary instead
of rebuilding from source.

## Known limitations

- Single LED by default — bump `LED_COUNT` in `TallyWatch.ino` and wire a small ring
  if you want a closer "spinning connect" look.
- Validated end-to-end on hardware (LED, WiFi join, live Companion sync — see
  `CHANGE_LOG.md`). Exercising mDNS discovery and OTA against multiple real beacons
  is the next thing to shake out as the fleet grows past one unit.
