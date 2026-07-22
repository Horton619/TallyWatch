# Change Log

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
