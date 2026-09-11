#!/usr/bin/env bash
# Bake the current firmware into the manager as its bundled .bin, so the app ships
# with a known-good firmware to compare against and push. Run before packaging.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$ROOT/manager/firmware"

VER=$(grep 'FW_VERSION =' "$ROOT/TallyWatch.ino" | sed -E 's/.*"([^"]+)".*/\1/')
CODENAME=$(grep 'FW_CODENAME =' "$ROOT/TallyWatch.ino" | sed -E 's/.*"([^"]+)".*/\1/')

echo "==> Building firmware v$VER ($CODENAME)"
node "$ROOT/tools/build-page.js"
# CDCOnBoot=cdc routes Serial to the native USB port (matches flash.sh + CI) so
# the bundled/OTA'd firmware supports USB serial provisioning.
arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc --output-dir "$ROOT/.build" "$ROOT"

mkdir -p "$OUT"
# clear any older bundled bin so only one ships
rm -f "$OUT"/TallyWatch-v*.bin
cp "$ROOT/.build/TallyWatch.ino.bin" "$OUT/TallyWatch-v$VER.bin"

cat > "$OUT/manifest.json" <<EOF
{
  "version": "$VER",
  "codename": "$CODENAME",
  "file": "TallyWatch-v$VER.bin"
}
EOF

echo "==> Bundled TallyWatch-v$VER.bin into manager/firmware/"
