#pragma once
// Copy this file to secrets.h (git-ignored) and fill in your values to bake
// zero-touch defaults into a locally-flashed beacon: it auto-joins your WiFi and
// points at Companion on first boot, with no setup-page step.
//
// Without a secrets.h, these stay blank and a fresh beacon boots into setup mode
// (hosting TallyWatch-Setup) instead — which is what the CI release build does.
// Saved settings (NVS) always override these, so OTA updates never clobber a
// beacon's real config.
#define DEFAULT_WIFI_SSID     "YourTallySSID"
#define DEFAULT_WIFI_PASS     "your-wifi-password"
#define DEFAULT_COMPANION_IP  "192.168.10.50"
