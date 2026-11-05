# Mannequin build (MPFB → glTF)

Builds the 3D try-on mannequin, `public/models/mannequin.glb`, and its calibration file,
`components/try-on-3d/mannequin-meta.json`.

```bash
bash tools/mpfb/build.sh
```

The first run calls `setup.sh`, which downloads the MPFB add-on and the MakeHuman asset
pack into `tools/mpfb/.downloads/` and installs them into a project-local Blender
profile (`tools/mpfb/.blender-user/`). Your normal Blender settings are left alone.
Both folders are git-ignored. A full rebuild takes about a minute.

## Versions

| Tool | Version |
|---|---|
| Blender | 5.2.3 LTS (`brew install --cask blender`) |
| MPFB | 2.0.18, from extensions.blender.org, checked by SHA-256 |
| MakeHuman system assets | `makehuman_system_assets_cc0.zip` |
| glTF compression | `@gltf-transform/cli` 4.5.1 (meshopt) |

## How the body becomes editable

MPFB shapes a human from targets (vertex offsets) and macro settings (sex, weight,
muscle, height). The browser can't run MPFB, so `build_mannequin.py` captures every
control as a plain morph target:

1. It builds the base: a young adult male with average proportions, about 173 cm.
2. For each control, it builds a fresh body with only that change, refits the eyes, brows
   and lashes, and records every vertex. Feet are pinned to the floor.
3. The morph target is the variant minus the base, exported on one skinned mesh with
   MPFB's default skeleton.

The app blends these on the GPU (`components/try-on-3d/appearance.ts` →
`morphWeights`). The blends add up linearly, which closely approximates MPFB's own
non-linear macro maths.

**Calibration.** The script also measures the base body and each body morph: height,
shoulders, and chest, waist and hip circumference at the app's heights, plus inseam.
The app uses these numbers to turn a user's measurements into morph weights.

**Mesh choice.** The full MPFB basemesh is about 14.5k vertices / 27k triangles once
helper geometry is removed. That's within the phone budget, so no low-poly proxy is
used: decimating would break the morph targets.

**Mustaches.** The asset pack has none, so the script models five simple strips
(chevron, pencil, handlebar, walrus, horseshoe). Each mustache vertex copies the morphs
and skin weights of the nearest skin vertex, so it follows the face sliders.

## Controls exported

Sex; body type (weight and muscle); height; face shape (7 shapes), face width and
fullness; nose width, length, hump, tip, nostrils and size; eye size and spacing;
mouth width and height, upper and lower lip, corners; chin prominence, width, height,
jaw width and pointed chin; shoulders; chest; waist; hips; leg length; belly. Eye colour
is an in-app recolour of MakeHuman's eye texture.

**Hair.** All ten MakeHuman system hairstyles (afro01, bob01, bob02, braid01, long01,
ponytail01, short01–04) are fitted to the body and exported as hidden meshes; the app
shows one at a time. Each carries only the morphs that move it. The build also writes
512 px grey-scale copies of their textures (and the eyebrow texture) to
`public/models/hair/` so the app can tint hair, brows and mustache to one colour.

**Garments.** Wardrobe items are worn as real MakeHuman garments, fitted to the body by
MPFB the same way as hair, so they are closed all round and follow every slider. Each
item in `components/try-on/garments.tsx` names one with `model`:

| model | MakeHuman asset (pack) | used for |
|---|---|---|
| polo | `namuhekam_male_polo_shirt` (Shirts 01) | Navy piqué polo |
| tee | `elvs_crude_t-shirt_male` (Shirts 01) | Bone tee, Ochre tee |
| sweater | `toigo_fisherman_sweater` (Shirts 01) | Breton long sleeve |
| shorts | `cortu_jeans_shorts` (Pants 01) | Printed lounge shorts |

The build also stores which skin each garment covers (MakeHuman's `delete_verts`) as
`_HIDE_<MODEL>` attributes on the body, so the app can hide skin under clothes. The polo
and sweater ship without that list; the app falls back to the garment's area, shrunk at
the edges. Grey-scale copies of each garment's own texture go to `public/models/garments/`
and are tinted to the item's colour; patterned items use their print or stripe instead.
`setup.sh` installs the system assets; for the garment packs, also run
`blender -b --factory-startup --python tools/mpfb/install_assets.py -- <shirts01_cc0.zip | pants01_cc0.zip>`
(downloads: files2.makehumancommunity.org/asset_packs/shirts01/shirts01_cc0.zip and
…/pants01/pants01_cc0.zip).

## Licences

| Asset | Licence |
|---|---|
| MPFB add-on code | GPL-3.0-or-later; used only as a build tool, not shipped |
| MakeHuman basemesh, targets, skeleton (via MPFB) | CC0 |
| MakeHuman system assets: eyes (`low-poly`), `eyebrow001`, `eyelashes01`, `grey_eye.png`, the ten system hairstyles and their textures | CC0 |
| MakeHuman Shirts 01 and Pants 01 packs: polo, tee, fisherman sweater, jeans shorts and their textures | CC0 |
| Mustache meshes | made by `build_mannequin.py`, part of this project |

Everything shipped in `public/models/` comes from CC0 assets or from this project.
No SMPL / SMPL-X data is used.

## Template garments (the downloaded packs)

`components/try-on-3d/template-garments.json` lists the extra garments the fitting room offers
(key, MakeHuman asset, kind, name, colour, credit). Build them, without touching the mannequin:

    bash tools/mpfb/build_garments.sh            # every one not built yet, 8 per batch
    bash tools/mpfb/build_garments.sh key1 key2  # just these

Each writes `public/models/garments/<key>.glb`, its textures and `<key>-hide.bin` (the skin it
covers, one byte per body vertex). meshopt reorders the mannequin's vertices, so batches map
their masks onto `tools/mpfb/body-order.f32`, which a full build rewrites. After a full
mannequin rebuild, rebuild the templates too (delete their `-hide.bin` files first).
