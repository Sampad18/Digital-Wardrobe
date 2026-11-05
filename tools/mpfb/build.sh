#!/usr/bin/env bash
# Rebuilds public/models/mannequin.glb and components/try-on-3d/mannequin-meta.json.
#
#   bash tools/mpfb/build.sh
#
# Runs setup.sh first if MPFB isn't installed in the project's Blender profile yet.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/tools/mpfb"
export BLENDER_USER_RESOURCES="$HERE/.blender-user"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"

[ -d "$BLENDER_USER_RESOURCES/extensions/user_default/mpfb" ] || bash "$HERE/setup.sh"

RAW="$ROOT/public/models/mannequin.raw.glb"
OUT="$ROOT/public/models/mannequin.glb"
META="$ROOT/components/try-on-3d/mannequin-meta.json"

cd "$ROOT"
"$BLENDER" -b --factory-startup --python "$HERE/build_mannequin.py" -- "$RAW" "$META" "$ROOT/public/models" < /dev/null

# Quantise and meshopt-compress; three.js decodes this with MeshoptDecoder.
# (A GARMENT_BATCH build only writes garments: the mannequin is left as it is.)
if [ -z "${GARMENT_BATCH:-}" ]; then
  npx -y @gltf-transform/cli@4.5.1 meshopt "$RAW" "$OUT" --level medium
  rm -f "$RAW"
  # meshopt reorders vertices; garment batches map their masks onto this order.
  [ -d "$HERE/.node/node_modules/meshoptimizer" ] || npm i --silent --prefix "$HERE/.node" @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 meshoptimizer@0.25.0
  NODE_PATH="$HERE/.node/node_modules" node --experimental-default-type=module "$HERE/decode_body_order.mjs" "$OUT" "$HERE/body-order.f32"
fi
for raw in "$ROOT"/public/models/garments/*.raw.glb; do
  npx -y @gltf-transform/cli@4.5.1 meshopt "$raw" "${raw%.raw.glb}.glb" --level medium >/dev/null
  rm -f "$raw"
done
ls -la "$OUT" "$ROOT"/public/models/garments/*.glb | tail -20
