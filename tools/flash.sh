#!/usr/bin/env bash
# TallyWatch batch flasher
# ------------------------
# Compiles the firmware once, then flashes it to each ESP32-C3 you plug in.
# Meant for building a batch of beacons without touching the Arduino IDE.
#
# One-time setup first:  tools/setup-toolchain.sh
# Then:                  tools/flash.sh
#   -> plug in a board, it flashes, unplug, plug the next, press Enter. Repeat.
#
# Board: ESP32-C3 Super Mini. CDCOnBoot=cdc keeps Serial working over the
# native USB port and lets the board auto-reset into the bootloader.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FQBN="esp32:esp32:esp32c3:CDCOnBoot=cdc"
BUILD_DIR="$ROOT/.build"

if ! command -v arduino-cli >/dev/null 2>&1; then
    echo "arduino-cli not found. Run tools/setup-toolchain.sh first." >&2
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "node not found — needed to build the embedded setup page." >&2
    exit 1
fi

echo "==> Building embedded setup page"
node "$ROOT/tools/build-page.js"

echo "==> Compiling firmware once (this is the slow part; flashing is fast)"
arduino-cli compile --fqbn "$FQBN" --output-dir "$BUILD_DIR" "$ROOT"

find_port() {
    # Prefer a board arduino-cli positively identifies; fall back to any C3-style
    # native-USB serial device on macOS (/dev/cu.usbmodem*) or Linux (/dev/ttyACM*).
    arduino-cli board list 2>/dev/null \
        | awk '/\/dev\/(cu\.usbmodem|cu\.usbserial|cu\.wchusbserial|ttyACM|ttyUSB)/ {print $1; exit}'
}

count=0
while true; do
    PORT="$(find_port || true)"
    if [ -z "${PORT:-}" ]; then
        printf "No board detected. Plug one in and press Enter (Ctrl-C to finish). "
        read -r _
        continue
    fi

    echo "==> Flashing board #$((count + 1)) on $PORT"
    if arduino-cli upload --fqbn "$FQBN" --port "$PORT" --input-dir "$BUILD_DIR" "$ROOT"; then
        count=$((count + 1))
        echo "    OK — flashed $count board(s) so far."
    else
        echo "    Upload failed. Re-seat the board / try again." >&2
    fi

    printf "Unplug this board, plug in the next, press Enter (Ctrl-C to finish). "
    read -r _
done
