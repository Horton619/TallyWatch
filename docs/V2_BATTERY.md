# TallyWatch V2 — Battery + Universal Mount (parked / future)

> Status: **not started.** This is a scoped idea for a second product variant,
> captured so it isn't lost. V1 (USB-C powered, laptop-mounted) ships first.

## The idea

A cordless TallyWatch beacon that runs off an internal battery and clips or
threads onto things — camera cages, light stands, monitor arms, laptop lids —
for positions where a USB-C cable isn't practical. Same firmware family as V1,
different board and enclosure.

## Why a different board

The ESP32-C3 Super Mini used in V1 has **no battery charging or protection
circuit**. Rather than bolt one on per unit, V2 should move to a board that
manages a LiPo natively:

**Recommended: Seeed Studio XIAO ESP32-C3.**
- Same ESP32-C3 chip → **same firmware** (only the `LED_PIN` / `BOOT_PIN`
  defines change to match its pinout).
- Tiny (21 × 17.5 mm) — suits a clip/camera-mount body far better than the
  Super Mini.
- **Onboard LiPo charging** via its USB-C, with dedicated B+ / B− battery pads.
- Battery voltage can be read on an analog pin through a resistor divider → lets
  us surface a **battery %** in the About page and a **low-battery amber pulse**
  on the LED, reusing the existing status-color language.

*(Cheaper fallback if reusing leftover Super Minis: add a TP4056-with-protection
charge module + the LiPo, and feed the board from it. More per-unit wiring and
less tidy — the XIAO is the cleaner "package.")*

## Runtime reality

A tally must stay connected to Companion, so it can't deep-sleep — current draw
is basically constant (~120–150 mA with the pixel lit). Plan the cell to the
show length:

| LiPo | Rough runtime |
|---|---|
| 500 mAh | ~3–4 hrs |
| 1000 mAh | ~6–8 hrs |
| 1500 mAh | ~9–12 hrs |

A 1000–1500 mAh pouch is a good balance of runtime vs. size.

## Mounting

- **¼-20 brass heat-set insert** in the enclosure base → tripods, magic arms,
  camera cages, most AV mounting hardware.
- **Cold-shoe adapter or spring clip** for laptop lids, monitors, light stands.
- Design the insert boss into the enclosure from the start; retrofitting a ¼-20
  is a pain.

## Firmware deltas from V1

- Remap `LED_PIN` / `BOOT_PIN` to the XIAO's pinout.
- Add a battery-voltage ADC read (divider on an analog pin).
- Add battery % to the `/about` payload + the About page.
- Add a low-battery indicator state (brief amber pulse) to the LED loop.

Everything else — WiFi, saved networks, setup page, Companion protocol — carries
over unchanged.

## Shopping list (V2 prototype, ~1 unit)

| Item | Approx. | Notes |
|---|---|---|
| Seeed XIAO ESP32-C3 | $5 | Board w/ onboard LiPo charging |
| LiPo 1000–1500 mAh w/ JST-PH | $8–10 | Match connector polarity to the board! |
| WS2812B pixel | ~$0.15 | Already have (BTF-Lighting 100-pack) |
| 2× resistors (e.g. 220 kΩ) | pennies | Battery-sense divider (ELEGOO kit) |
| ¼-20 brass heat-set insert | ~$0.30 | Buy a small assortment |
| Cold-shoe adapter or spring clip | $3–8 | Mount style, pick per use |
| Slide/rocker power switch | ~$1 | Optional hard off between shows |
| 3D-printed enclosure | — | New body w/ mount boss + battery bay |

*Prices are rough US ballparks; confirm at purchase.*

## Open questions for when this is picked up

- Power switch, or rely on the enclosure being openable to disconnect?
- Charge-while-running okay, or is that a fire-safety / heat concern in a sealed
  enclosure? (Affects venting.)
- Battery % surfaced only in the setup page, or also a quick LED "fuel gauge"
  gesture (e.g. tap BOOT → flashes green/amber/red for battery level)?
