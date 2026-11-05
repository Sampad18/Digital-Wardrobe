"""Installs a MakeHuman asset pack zip into MPFB's user data folder.

Run by setup.sh:  blender -b --factory-startup --python install_assets.py -- <pack.zip>
Same steps as MPFB's "Install pack from zip" button, without the UI.
"""

import sys
import zipfile

import addon_utils

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)

from bl_ext.user_default.mpfb.services import AssetService, LocationService  # noqa: E402

pack = sys.argv[sys.argv.index("--") + 1]
data_dir = LocationService.get_user_data()

problem = AssetService.check_asset_pack_zip(pack)
if problem is None:
    with zipfile.ZipFile(pack) as zf:
        zf.extractall(data_dir)
else:
    # Some packs nest their folders one level too deep; MPFB knows how to fix that.
    problem = AssetService.fix_and_extract_asset_pack_zip(pack, data_dir)
    if problem is not None:
        sys.exit(f"Asset pack could not be installed: {problem}")

AssetService.update_all_asset_lists()
print(f"Installed {pack} into {data_dir}")
