#!/usr/bin/env bash
# One-time setup for the mannequin build: installs the MPFB add-on and the
# MakeHuman system assets into a project-local Blender profile, so your normal
# Blender settings are left alone.
#
#   bash tools/mpfb/setup.sh
#
# Needs Blender >= 4.2 (MPFB's minimum). Tested with Blender 5.2.3 and MPFB 2.0.18.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DL="$HERE/.downloads"
export BLENDER_USER_RESOURCES="$HERE/.blender-user"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"

MPFB_VERSION="2.0.18"
MPFB_SHA256="c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad"
MPFB_ZIP="$DL/add-on-mpfb-v$MPFB_VERSION.zip"
MPFB_URL="https://extensions.blender.org/download/sha256:$MPFB_SHA256/add-on-mpfb-v$MPFB_VERSION.zip"
ASSETS_ZIP="$DL/makehuman_system_assets_cc0.zip"
ASSETS_URL="https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip"

mkdir -p "$DL" "$BLENDER_USER_RESOURCES"
[ -f "$MPFB_ZIP" ] || curl -sSL -o "$MPFB_ZIP" "$MPFB_URL"
echo "$MPFB_SHA256  $MPFB_ZIP" | shasum -a 256 -c -
[ -f "$ASSETS_ZIP" ] || curl -sSL -o "$ASSETS_ZIP" "$ASSETS_URL"

"$BLENDER" --version | head -1
"$BLENDER" --command extension install-file -r user_default -e "$MPFB_ZIP"
"$BLENDER" -b --factory-startup --python "$HERE/install_assets.py" -- "$ASSETS_ZIP"
echo "MPFB ready in $BLENDER_USER_RESOURCES"
