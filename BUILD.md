# TallyWatch — Build & Deploy Guide (V1, USB-C powered)

The whole system, from bare parts to a working tally beacon on a Companion
network. No prior firmware experience needed — the flashing is two scripted
commands.

---

## 1. What's in the system

TallyWatch has two pieces:

1. **Tally beacons** — the ESP32-C3 + LED units that light up. One per laptop /
   position. (This guide builds these.)
2. **Base station** — a small WiFi access point that plugs into your wired
   production network and gives the beacons something to join. See
   [Networking](#5-networking-the-base-station) below.

The beacons talk to Bitfocus Companion over its Satellite API and mirror the
color of a Companion button, so a graphics op can see at a glance which source
is live.

---

## 2. Bill of materials — per beacon

| Part | Notes | Qty |
|---|---|---|
| ESP32-C3 Super Mini | The board. USB-C. | 1 |
| WS2812B pixel (BTF-Lighting single 5050) | The light. | 1 |
| Hookup wire | 3 short lengths (data, power, ground) | — |
| Heat-shrink | Insulate the LED solder joints | — |
| USB-C cable | Power from the laptop or a nearby source | 1 |
| 3D-printed enclosure + diffuser | Houses board + LED | 1 |

*(You already have the ELEGOO kit, a 10-pack of Super Minis, 100 WS2812B
pixels, and heat-shrink — that's a full run of beacons plus spares.)*

---

## 3. Wiring

Three wires from the board to the pixel. **Use the LED's DIN (data-in) pad** —
on the BTF-Lighting pixels the arrow points *away* from IN, toward OUT. Get this
backwards and nothing lights.

```
   ESP32-C3 Super Mini            WS2812B pixel
   -------------------            -------------
   GPIO3  ───────────────────►    DIN  (data in, arrow points away)
   3V3    ───────────────────►    VCC / 5V / +
   GND    ───────────────────►    GND / -
```

**Why VCC goes to 3V3, not 5V:** the WS2812B wants a data "high" near 3.5 V when
run at 5 V, but the C3 only drives 3.3 V — right under the line, which causes
flicker or wrong colors. Powering the pixel from **3V3** drops that threshold so
a single pixel is rock-solid.

- Want **maximum brightness** (for lit stages / Ultra Bright Mode)? Instead
  power VCC from **5V through a series Schottky diode** (any 1N5817-class part
  from the ELEGOO kit works) — that lands ~4.5 V, bright, and the 3.3 V data
  still clears the threshold.

Insulate each joint with heat-shrink (slide it on *before* soldering the second
end — easy to forget). A single pixel draws well under what a laptop USB-C port
supplies, so no separate power needed.

**Optional signal-integrity insurance** (from the ELEGOO kit, both cheap, both
skippable — a single pixel on a short wire run almost always works without
either): a ~330 Ω resistor inline on the **data** wire, and a 470–1000 µF
capacitor across the LED's **VCC/GND right at the LED**. Worth adding if you see
any first-frame glitches.

**Tip: flash before you solder.** It's easier to get a clean USB connection and
watch the serial output while the board is still bare — do [section 4](#4-flashing-the-firmware)
first, confirm it boots (breathes blue, no WiFi yet), *then* wire the LED.

---

## 4. Flashing the firmware

### One-time setup (per computer)

You need `arduino-cli`. On macOS:

```sh
brew install arduino-cli          # if you don't already have it
tools/setup-toolchain.sh          # installs the ESP32 core + libraries
```

### Flash the boards

```sh
tools/flash.sh
```

It compiles once, then walks you through boards one at a time: it flashes the
plugged-in board, you unplug it and plug in the next, press Enter, repeat. Do
all 10 in a few minutes.

*(No command line at all? You can also open `TallyWatch.ino` in the Arduino IDE,
pick "ESP32C3 Dev Module", set "USB CDC On Boot: Enabled", and hit Upload — one
board at a time. The script just automates that.)*

---

## 5. First-run configuration (per beacon)

1. Power the beacon over USB-C. With no saved WiFi, it boots straight into
   **setup mode** — the LED breathes green and it hosts a WiFi network called
   **`TallyWatch-Setup`** (password `tally1234`).
2. On a phone or laptop, join `TallyWatch-Setup`, then browse to
   **`192.168.4.1`**. The TallyWatch setup page loads.
3. **Network** → add the tally WiFi (scan or add manually). This should be the
   same SSID your base station broadcasts (see below).
4. **Companion** → enter the IP of the machine running Companion, and the
   Satellite port (default `16622`).
5. **Save & Restart.** The beacon reboots, joins WiFi (breathes blue), connects
   to Companion (breathes red), then goes dark and starts mirroring.

To reconfigure later: hold **BOOT** 3–7 s until it breathes green, release.
Factory reset: hold **BOOT** past 7 s until it flashes white.

### Companion side (once)

In Companion: **Surfaces** tab → the device shows up as **TallyWatch** → open its
**Settings** → set **Current Page / Horizontal Offset / Vertical Offset** to the
button you want mirrored. Done.

> **Deployment tip:** to make the beacons truly plug-and-play, give every unit
> the *same* saved WiFi network as its first saved network — the one your base
> station broadcasts. Then any beacon joins any deployment automatically. You can
> also configure one beacon, **Export Config** from the Import/Export screen, and
> **Import** it onto the rest so they're identical.

---

## 6. Networking: the base station

Beacons are 2.4 GHz WiFi. To get them onto a hardwired production network you
need a small access point bridged to the wired LAN.

### Base station: MikroTik mAP lite (RBmAPL-2nD)

The pick for a transported kit — it's the smallest option (48 × 49 × 11 mm,
~25 g), takes **native 802.3af/at PoE** so it's a single component with no power
brick or splitter dongle to pack, and run on PoE it never exposes a USB port.

- Buy from a WISP vendor for real stock/price (Amazon resellers mark it up):
  [Streakwave](https://www.streakwave.com/mikrotik-rbmapl-2nd-24ghz-map-lite-ap-80211bgn-2x2) ·
  [Baltic Networks](https://www.balticnetworks.com/products/mikrotik-map-lite-2-4ghz-magnetic-dual-chain-indoor-ap) ·
  [ISP Supplies](https://www.ispsupplies.com/MikroTik-RBmAPL-2nD)
- **One-time setup:** config scripts + steps in
  [docs/basestation-maplite.md](docs/basestation-maplite.md). Configure it once
  and it's permanent.
- **Default is bridge mode** — the mAP lite is a plain access point, beacons get
  static IPs on the production LAN (same subnet as the Companion laptop), and the
  TallyWatch Manager runs right on that laptop. A NAT/isolation variant is
  available if you'd rather keep wireless off the control network.

### PoE for the kit — TP-Link TL-POE160S injector

Keep one of these in the kit to power the mAP lite off any **non-PoE gigabit
switch**. Gigabit 802.3af/at, plug-and-play, compact wall-mount brick, ~$18.
(If the venue's switch already does PoE, you don't need it.)

- [TP-Link TL-POE160S on Amazon](https://www.amazon.com/TP-Link-Injector-Supplies-Wall-Mount-TL-PoE160S/dp/B08LQP8CYD)

### Easier-config alternative: GL.iNet Opal (GL-SFT1200)

Bigger (118 × 85 × 30 mm) and needs a USB-C PoE splitter for a cable run, but its
web UI has a simple "Access Point" dropdown if RouterOS isn't for you. USB-C
powered. [Opal on Amazon](https://www.amazon.com/GL-iNet-GL-SFT1200-Secure-Travel-Router/dp/B09N72FMH5).
Skip WiFi-6/7 travel routers (e.g. Beryl 7, ~$140) — your beacons are 2.4 GHz-only,
so they buy you nothing.

Whichever you use: broadcast the one standard tally SSID, and set that same SSID
as saved network #1 on every beacon so they auto-join wherever the base station
is deployed. The [base station guide](docs/basestation-maplite.md) covers the NAT
config (default for static networks) and a bridge variant.

---

## 7. Status light reference

| Pattern | Meaning |
|---|---|
| Breathing blue | Connecting to WiFi |
| Breathing red | WiFi up, connecting to Companion |
| Breathing green | Setup mode |
| White flash | Factory reset confirmed |
| Solid color | Live — mirroring the assigned Companion button |

Each of blue/red/green can be turned off per beacon under **Device → Status
Indicators** if you want a beacon dark until it's actually live.

---

## 8. Enclosure checklist

You're designing/printing the case yourself — treat this as things to account
for, not a fixed design:

- **Bench-test before you enclose.** Power over USB-C sitting loose, run through
  the status colors and a real Companion sync. Cases put slight strain on joints
  that were fine on the open bench — this is your last easy chance to fix one.
- **LED placement** — face the pixel directly into whatever diffuses it (dome,
  frosted wall). WS2812Bs are directional, so keep it close to the diffusing
  surface, not floating in a large cavity.
- **BOOT button access** — you need it after the case is closed (setup + factory
  reset). Expose it through a small hole, or print a nub that lands on the button
  when pressed from outside.
- **USB-C cutout** — it's power *and* the reflash/serial port, so don't bury it.
- **Strain relief** — don't let the three LED wires be what holds the pixel in
  place. A dab of hot glue or a printed cradle keeps the solder joints from being
  the structural connection.
- **Board mounting** — most Super Minis have small mounting holes; printed
  standoffs beat tape/friction fit for something handled during a production.
