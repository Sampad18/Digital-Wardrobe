#!/usr/bin/env bash
# Downloads every MakeHuman clothing asset pack (garments, shoes, underwear, gloves,
# hats/caps, and extra materials for the system clothes) into tools/mpfb/.downloads/
# and installs each into the project's MPFB profile. Skips packs already downloaded.
#
#   bash tools/mpfb/download_clothes.sh
#
# Licences: *_cc0.zip packs are CC0; *_ccby / *_cc-by packs are CC-BY (credit the
# authors listed on https://static.makehumancommunity.org/assets/assetpacks.html).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DL="$HERE/.downloads"
export BLENDER_USER_RESOURCES="$HERE/.blender-user"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
BASE="https://files2.makehumancommunity.org/asset_packs"

PACKS=(
  shirts01/shirts01_cc0 shirts02/shirts02_ccby shirts03/shirts03_ccby
  pants01/pants01_cc0 pants02/pants02_ccby pants03/pants03_ccby
  skirts01/skirts01_cc0 skirts02/skirts02_cc-by
  dress01/dress01_cc0 dress02/dress02_cc-by dress03/dress03_cc-by
  suits01/suits01_cc0 suits02/suits02_cc0 suits03/suits03_cc-by
  shoes01/shoes01_cc0 shoes02/shoes02_ccby shoes03/shoes03_ccby
  underwear01/underwear01_cc0 underwear02/underwear02_cc0 underwear03/underwear03_cc-by underwear04/underwear04_cc0
  gloves01/gloves01_cc0 hats01/hats01_cc0 hats03/hats03_cc-by
  system_clothes_materials01/system_clothes_materials01_cc0
)

mkdir -p "$DL"
ok=0; failed=()
for p in "${PACKS[@]}"; do
  zip="$DL/$(basename "$p").zip"
  if [ ! -f "$zip" ] || ! unzip -tq "$zip" >/dev/null 2>&1; then
    echo "[clothes] downloading $(basename "$p")"
    if ! curl -sSL --retry 3 -o "$zip.part" "$BASE/$p.zip" || ! unzip -tq "$zip.part" >/dev/null 2>&1; then
      echo "[clothes] FAILED $(basename "$p")"; failed+=("$(basename "$p")"); rm -f "$zip.part"; continue
    fi
    mv "$zip.part" "$zip"
  fi
  "$BLENDER" -b --factory-startup --python "$HERE/install_assets.py" -- "$zip" < /dev/null 2>&1 | grep -E "^Installed|could not" | sed 's/^/[clothes] /'
  ok=$((ok + 1))
done
echo "[clothes] done: $ok installed, ${#failed[@]} failed ${failed[*]:-}"
