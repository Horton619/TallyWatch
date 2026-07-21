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

Wiring: LED data pin → GPIO2 (`LED_PIN` in `TallyWatch.ino`), LED power → 3.3V/5V and
GND per your LED's spec. No external button needed — the board's onboard BOOT button
(GPIO9) doubles as the setup/reset button.

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

## Known limitations

- No OTA firmware update (re-flash over USB).
- Single LED by default — bump `LED_COUNT` in `TallyWatch.ino` and wire a small ring
  if you want a closer "spinning connect" look.
- Compiled from source but not yet verified on real hardware in this pass — see
  `CHANGE_LOG.md`.
