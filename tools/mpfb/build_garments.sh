#!/usr/bin/env bash
# Builds the template garments listed in components/try-on-3d/template-garments.json into
# public/models/garments/ (<key>.glb, textures and <key>-hide.bin), in batches of 8, without
# rebuilding the mannequin. Skips garments already built.
#
#   bash tools/mpfb/build_garments.sh            # every missing garment
#   bash tools/mpfb/build_garments.sh key1 key2  # just these
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
if [ $# -gt 0 ]; then keys=("$@"); else
  keys=($(python3 -c "import json;[print(g['key']) for g in json.load(open('$ROOT/components/try-on-3d/template-garments.json'))]"))
fi
todo=()
for k in "${keys[@]}"; do [ -f "$ROOT/public/models/garments/$k-hide.bin" ] || todo+=("$k"); done
echo "[garments] ${#todo[@]} to build"
for ((i = 0; i < ${#todo[@]}; i += 8)); do
  batch=$(IFS=,; echo "${todo[*]:i:8}")
  echo "[garments] batch $((i / 8 + 1)): $batch"
  GARMENT_BATCH="$batch" bash "$HERE/build.sh"
done
echo "[garments] done"
