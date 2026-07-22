#!/usr/bin/env bash
# One-time toolchain setup for flashing TallyWatch from the command line.
# Installs the ESP32 board package and the two libraries the firmware needs.
# Run this once per machine, then use tools/flash.sh to flash boards.

set -euo pipefail

if ! command -v arduino-cli >/dev/null 2>&1; then
    echo "arduino-cli is not installed. Install it first, then re-run this:" >&2
    echo "    brew install arduino-cli" >&2
    echo "  (or see https://arduino.github.io/arduino-cli/latest/installation/)" >&2
    exit 1
fi

ESP32_INDEX="https://espressif.github.io/arduino-esp32/package_esp32_index.json"

echo "==> Initializing arduino-cli config"
arduino-cli config init --overwrite >/dev/null

echo "==> Adding the Espressif ESP32 board index"
arduino-cli config add board_manager.additional_urls "$ESP32_INDEX"

echo "==> Updating package index"
arduino-cli core update-index

echo "==> Installing ESP32 core (large download, one time)"
arduino-cli core install esp32:esp32

echo "==> Installing libraries"
arduino-cli lib install "Adafruit NeoPixel"
arduino-cli lib install "ArduinoJson"

echo
echo "Toolchain ready. Plug in an ESP32-C3 and run:  tools/flash.sh"
