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

Not yet verified on physical hardware — compile and end-to-end (WiFi, Companion
handshake, LED behavior) testing is the next step.
