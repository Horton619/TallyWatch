# TallyWatch Beacon — Schematic & Wiring Guide

Everything needed to assemble one beacon. **Short answer to the power question: the
board's onboard USB port powers both the ESP32-C3 and the LED. No external supply, no
powered hub, nothing to split out.**

---

## 1. Power budget — why USB is enough

| Load | Draw |
|---|---|
| ESP32-C3, WiFi active | ~80–120 mA average (~350 mA brief transmit peaks) |
| WS2812B ×1, full white | 60 mA absolute max (a single tally color ≈ 20 mA) |
| **Total** | **~150–200 mA typical, under 450 mA worst case** |
| Available: USB 2.0 / USB-C | 500 mA / 900 mA – 3 A |

One USB-C cable from the laptop (or any charger) runs the whole beacon with margin to
spare. Each beacon has its own cable, so there's no shared-supply concern across a fleet.

---

## 2. Schematic

```
   USB-C ──► ESP32-C3 Super Mini
                    │
                    ├── 5V ────►|──────────────────────────►  LED  VCC   (~4.3 V)
                    │        D1: 1N4148 / 1N4007
                    │        (silicon, ~0.7 V drop)
                    │
                    ├── GND ───────────────────────────────►  LED  GND
                    │
                    └── GPIO3 ──[ R1: 330 Ω (optional) ]───►  LED  DIN

              optional: C1 100 nF across LED VCC ↔ GND, right at the LED
              (LED DOUT is unused — it's only for chaining more pixels)
```

**Diode orientation matters:** the banded end (cathode) goes toward the **LED**. Backwards
and the LED gets nothing.

---

## 3. Connections, pin by pin

| ESP32-C3 Super Mini | via | WS2812B pixel |
|---|---|---|
| `5V` | **D1 silicon diode** (band toward LED) | `VCC` / `5V` / `+` |
| `GND` | — | `GND` / `−` |
| `GPIO3` | optional 330 Ω resistor | `DIN` (data **in**) |

`GPIO9` is the onboard BOOT button — used for setup mode and factory reset. Nothing to
wire; just keep it reachable through the enclosure.

---

## 4. Why the diode (don't skip this)

The WS2812B decides a data bit is "high" at **0.7 × its supply voltage**. That single fact
drives the whole design:

| LED supply | Data-high needed | C3 outputs | Result |
|---|---|---|---|
| 5.0 V (direct) | 3.50 V | 3.3 V | ❌ below threshold — flicker, wrong colors |
| **4.3 V (via diode)** | **3.01 V** | **3.3 V** | ✅ **0.3 V margin — reliable** |
| 3.3 V (from 3V3 pin) | 2.31 V | 3.3 V | ⚠ data fine, but **below the LED's 3.5 V minimum** — green/blue go dim or drop out |

The diode is the only option that satisfies *both* the LED's minimum supply voltage and
the logic threshold. It costs one part you already own.

> **Why not just power it from 3V3?** It's tempting (zero extra parts) and the data side
> works — but 3.3 V is under the WS2812B's ~3.5 V minimum. Green and blue have a ~3.2 V
> forward voltage, so they wash out and colors skew red. On a tally light, where an
> unambiguous red vs. green *is* the product, that's not acceptable.

---

## 5. Optional parts (cheap insurance, all in the ELEGOO kit)

Both are skippable for a single pixel on a short lead — add them if you see any flicker or
first-frame glitches:

- **R1, 330 Ω** in series on the data line, placed close to the ESP32 pin. Damps ringing on
  the data edge.
- **C1, 100 nF** ceramic across the LED's VCC↔GND, placed right at the LED. Local
  decoupling for the switching current. (A larger 470–1000 µF electrolytic on the 5 V rail
  is overkill here but harmless.)

---

## 6. Assembly order

1. **Flash first, while the board is bare** — easier USB access and you can watch the
   serial output. See [BUILD.md](../BUILD.md).
2. **Cut three leads**, 6–10 cm: power, ground, data. Strip ~3 mm and tin both ends.
3. **Slide heat-shrink on before soldering the second end** of each lead — the classic
   thing to forget.
4. **Solder the diode inline** on the 5 V lead, band toward the LED. Insulate it.
5. **Solder to the LED pads**: VCC, GND, DIN. Confirm you're on **DIN**, not DOUT — on the
   BTF-Lighting modules the arrow points *away* from DIN, toward DOUT.
6. **Bench test before enclosing** — power over USB, confirm the LED lights and cycles
   through its status colors. Check that **green looks properly green**; a weak or
   yellow-green is the tell-tale of a supply-voltage problem.
7. **Enclose** — see the enclosure checklist in [BUILD.md](../BUILD.md).

---

## 7. Bench check

| Symptom | Likely cause |
|---|---|
| Nothing lights | Diode backwards, or wired to DOUT instead of DIN |
| Flicker / random colors | Data threshold — confirm the diode is present on VCC |
| Green/blue dim, everything reddish | LED supply too low (powered from 3V3?) |
| First frame glitches | Add the 330 Ω data resistor and 100 nF cap |
| LED fine, no WiFi | Unrelated — check the setup page, not the wiring |
