"""Builds public/models/mannequin.glb: one MPFB body whose shape is editable in
the browser through glTF morph targets.

    bash tools/mpfb/build.sh        (sets up the Blender profile and runs this)

How it works
------------
MPFB shapes a human from "targets" (vertex offsets) and "macro" settings
(gender, weight, muscle, ...). Blender can't export MPFB's live macro maths,
so every control is captured as a plain offset from one neutral base body:

  1. Build the base: young adult male, average everything.
  2. For each control, build a fresh body with just that change applied,
     refit the eyes/brows/lashes, and record every vertex.
  3. Morph target = variant - base. Feet are pinned to the floor, so leg and
     height changes grow the body upwards instead of sinking it.
  4. Bake the base into a clean mesh with a skeleton, attach the morphs,
     add mustache meshes that follow the face morphs, and export.

The browser then blends these morphs on the GPU. They add up linearly, which
is a close approximation of MPFB's own (non-linear) macro maths.
"""

import json
import math
import os
import sys

import addon_utils
import bmesh
import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)

from bl_ext.user_default.mpfb.services import (  # noqa: E402
    AssetService,
    HumanService,
    LocationService,
    TargetService,
)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0] if ARGS else "public/models/mannequin.raw.glb")
META = os.path.abspath(ARGS[1] if len(ARGS) > 1 else "components/try-on-3d/mannequin-meta.json")

BASE_MACROS = {"gender": 1.0, "age": 0.5, "muscle": 0.5, "weight": 0.5, "height": 0.5, "proportions": 0.5}

# Parts fitted to the body from the MakeHuman system assets (CC0).
HAIR = ["afro01", "bob01", "bob02", "braid01", "long01", "ponytail01", "short01", "short02", "short03", "short04"]
PARTS = [
    ("Eyes", "eyes/low-poly/low-poly.mhclo"),
    ("Eyebrows", "eyebrows/eyebrow001/eyebrow001.mhclo"),
    ("Eyelashes", "eyelashes/eyelashes01/eyelashes01.mhclo"),
    *[(f"Hair-{h}", f"hair/{h}/{h}.mhclo") for h in HAIR],
]
# Garments from MakeHuman's CC0 packs (shirts01, pants01): key -> (asset, subdivision levels).
# Level 1 is MPFB's own default for clothes: garment meshes are modelled low-poly and
# rely on that smoothing pass, so without it hems, cuffs and collars look faceted.
# Dense meshes (≈4,500+ vertices) are already smooth and skip it to keep their files small.
# Each garment is exported to its own public/models/garments/<key>.glb, loaded when worn.
GARMENTS = {
    # CC0: Shirts 01, Pants 01, Dress 01
    "polo": ("namuhekam_male_polo_shirt", 1),
    "tee": ("elvs_crude_t-shirt_male", 1),
    "sweater": ("toigo_fisherman_sweater", 1),
    "shorts": ("cortu_jeans_shorts", 1),
    "cargo": ("cortu_cargo_pants", 1),
    "shiftdress": ("toigo_shift_dress", 0),
    "halterdress": ("toigo_halter_dress_knee_length", 1),
    # CC-BY (credit the authors): Shirts 02/03, Pants 02/03, Skirts 02
    "shirt": ("elvs_male_shirt_untucked_bd1", 0),
    "hoodie": ("elvs_hooded_sweat_jacket1", 0),
    "tank": ("elvs_male_tankshirt1", 1),
    "knit": ("mindfront_knitted_sweater_01", 1),
    "jeans": ("punkduck_male_classic_jeans", 1),
    "trousers": ("elvs_male_trouser", 1),
    "shorttrousers": ("elvs_male_trouser_short_1", 0),
    "pencilskirt": ("elvs_pencil_skirt", 1),
    "tightjeans": ("punkduck_female_tight_jeans", 1),
    "vneck": ("punkduck_v_neck_top", 1),
}
# More garments from the downloaded packs, listed with the app's names and colours in
# components/try-on-3d/template-garments.json. They're built in batches, without touching
# the mannequin:  GARMENT_BATCH=key1,key2 bash tools/mpfb/build.sh  (see build_garments.sh).
# Their subdivision level is chosen from the mesh's density (level None).
EXTRA_GARMENTS = {g["key"]: g["asset"] for g in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../components/try-on-3d/template-garments.json")))}
BATCH = [k for k in os.environ.get("GARMENT_BATCH", "").split(",") if k]
if BATCH:
    GARMENTS = {k: (EXTRA_GARMENTS[k], None) for k in BATCH}
    PARTS = []  # only the body and the batch: hair, eyes and the mannequin aren't rebuilt
PARTS += [(f"Garment-{key}", f"clothes/{name}/{name}.mhclo") for key, (name, _) in GARMENTS.items()]


def garment_levels(key):
    """MPFB's smoothing level for a garment: 1, unless its mesh is already dense."""
    name, levels = GARMENTS[key]
    if levels is not None:
        return levels
    folder = os.path.join(LocationService.get_user_data(), "clothes", name)
    obj = next(f for f in os.listdir(folder) if f.endswith(".obj"))
    with open(os.path.join(folder, obj)) as f:
        verts = sum(1 for line in f if line.startswith("v "))
    return 0 if verts > 4000 else 1


def garment_texture(folder, kind):
    """The texture a garment's own material (.mhmat) uses: kind is diffuseTexture or normalmapTexture."""
    for f in sorted(os.listdir(folder)):
        if f.endswith(".mhmat"):
            with open(os.path.join(folder, f)) as mat:
                for line in mat:
                    words = line.split()
                    if len(words) >= 2 and words[0] == kind:
                        path = os.path.join(folder, os.path.basename(words[1]))
                        if os.path.exists(path):
                            return path
    return None
TEXTURES = os.path.abspath(ARGS[2] if len(ARGS) > 2 else "public/models")

# Each morph: name -> (macro overrides, {target: weight}). Paired l-/r- targets
# are applied together so the face stays symmetric.
def pair(a, b, w=1.0):
    return {a: w, b: w}

MORPHS = {
    # Body type and sex (macros)
    "female": ({"gender": 0.0}, {}),
    "weight-min": ({"weight": 0.0}, {}),
    "weight-max": ({"weight": 1.0}, {}),
    "muscle-min": ({"muscle": 0.0}, {}),
    "muscle-max": ({"muscle": 1.0}, {}),
    "height-min": ({"height": 0.0}, {}),
    "height-max": ({"height": 1.0}, {}),
    # 1 Face structure
    "face-oval": ({}, {"head-oval": 1}),
    "face-round": ({}, {"head-round": 1}),
    "face-square": ({}, {"head-square": 1}),
    "face-triangular": ({}, {"head-triangular": 1}),
    "face-heart": ({}, {"head-invertedtriangular": 1}),
    "face-diamond": ({}, {"head-diamond": 1}),
    "face-long": ({}, {"head-rectangular": 1}),
    "face-width-incr": ({}, {"head-scale-horiz-incr": 1}),
    "face-width-decr": ({}, {"head-scale-horiz-decr": 1}),
    "face-fat-incr": ({}, {"head-fat-incr": 1}),
    "face-fat-decr": ({}, {"head-fat-decr": 1}),
    # 2 Nose structure
    "nose-width-incr": ({}, {"nose-scale-horiz-incr": 1}),
    "nose-width-decr": ({}, {"nose-scale-horiz-decr": 1}),
    "nose-length-incr": ({}, {"nose-scale-vert-incr": 1}),
    "nose-length-decr": ({}, {"nose-scale-vert-decr": 1}),
    "nose-hump-incr": ({}, {"nose-hump-incr": 1}),
    "nose-hump-decr": ({}, {"nose-hump-decr": 1}),
    "nose-tip-up": ({}, {"nose-point-up": 1}),
    "nose-tip-down": ({}, {"nose-point-down": 1}),
    "nose-nostrils-incr": ({}, {"nose-nostrils-width-incr": 1}),
    "nose-nostrils-decr": ({}, {"nose-nostrils-width-decr": 1}),
    "nose-size-incr": ({}, {"nose-volume-incr": 1}),
    "nose-size-decr": ({}, {"nose-volume-decr": 1}),
    # 3 Eyes
    "eye-size-incr": ({}, pair("l-eye-scale-incr", "r-eye-scale-incr")),
    "eye-size-decr": ({}, pair("l-eye-scale-decr", "r-eye-scale-decr")),
    "eye-distance-incr": ({}, pair("l-eye-trans-out", "r-eye-trans-out")),
    "eye-distance-decr": ({}, pair("l-eye-trans-in", "r-eye-trans-in")),
    # 4 Mouth
    "mouth-width-incr": ({}, {"mouth-scale-horiz-incr": 1}),
    "mouth-width-decr": ({}, {"mouth-scale-horiz-decr": 1}),
    "mouth-height-incr": ({}, {"mouth-scale-vert-incr": 1}),
    "mouth-height-decr": ({}, {"mouth-scale-vert-decr": 1}),
    "lip-upper-incr": ({}, {"mouth-upperlip-volume-incr": 1}),
    "lip-upper-decr": ({}, {"mouth-upperlip-volume-decr": 1}),
    "lip-lower-incr": ({}, {"mouth-lowerlip-volume-incr": 1}),
    "lip-lower-decr": ({}, {"mouth-lowerlip-volume-decr": 1}),
    "mouth-corners-up": ({}, {"mouth-angles-up": 1}),
    "mouth-corners-down": ({}, {"mouth-angles-down": 1}),
    # 5 Chin and jaw
    "chin-prominent-incr": ({}, {"chin-prominent-incr": 1}),
    "chin-prominent-decr": ({}, {"chin-prominent-decr": 1}),
    "chin-width-incr": ({}, {"chin-width-incr": 1}),
    "chin-width-decr": ({}, {"chin-width-decr": 1}),
    "chin-height-incr": ({}, {"chin-height-incr": 1}),
    "chin-height-decr": ({}, {"chin-height-decr": 1}),
    "jaw-width-incr": ({}, {"chin-bones-incr": 1}),
    "jaw-width-decr": ({}, {"chin-bones-decr": 1}),
    "chin-pointed": ({}, {"chin-triangle": 1}),
    # 8-13 Body measurements
    "shoulders-incr": ({}, {"measure-shoulder-dist-incr": 1}),
    "shoulders-decr": ({}, {"measure-shoulder-dist-decr": 1}),
    "chest-incr": ({}, {"measure-bust-circ-incr": 1}),
    "chest-decr": ({}, {"measure-bust-circ-decr": 1}),
    "waist-incr": ({}, {"measure-waist-circ-incr": 1}),
    "waist-decr": ({}, {"measure-waist-circ-decr": 1}),
    "hips-incr": ({}, {"measure-hips-circ-incr": 1}),
    "hips-decr": ({}, {"measure-hips-circ-decr": 1}),
    "legs-incr": ({}, {"upperlegs-height-incr": 1, "lowerlegs-height-incr": 1}),
    "legs-decr": ({}, {"upperlegs-height-decr": 1, "lowerlegs-height-decr": 1}),
    "belly-incr": ({}, {"stomach-pregnant-incr": 1}),
    "belly-decr": ({}, {"stomach-pregnant-decr": 1}),
}


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


_TARGETS = {}


def target_path(name):
    """Full path of an MPFB target file, found by name anywhere under data/targets."""
    if not _TARGETS:
        root = LocationService.get_mpfb_data("targets")
        for folder, _, files in os.walk(root):
            for f in files:
                if f.endswith(".target.gz"):
                    _TARGETS[f[: -len(".target.gz")]] = os.path.join(folder, f)
    return _TARGETS[name]


def build_human(macros, targets, with_parts):
    """A fresh human with the given macros and targets, plus fitted parts."""
    clear_scene()
    detail = TargetService.get_default_macro_info_dict()
    detail.update({**BASE_MACROS, **macros})
    basemesh = HumanService.create_human(macro_detail_dict=detail, feet_on_ground=True)
    for name, weight in targets.items():
        TargetService.load_target(basemesh, target_path(name), weight=weight, name=name)
    parts = {}
    if with_parts:
        data = LocationService.get_user_data()
        for label, rel in PARTS:
            path = os.path.join(data, rel)
            if os.path.exists(path):
                kind = "Hair" if label.startswith("Hair-") else "Clothes" if label.startswith("Garment-") else label
                levels = garment_levels(label[len("Garment-"):]) if label.startswith("Garment-") else 0
                parts[label] = HumanService.add_mhclo_asset(path, basemesh, asset_type=kind, subdiv_levels=levels)
                # MPFB adds subdivision for renders only (levels 0, render_levels N) and its own
                # exporter copies the render level across before exporting; do the same.
                for mod in parts[label].modifiers:
                    if mod.type == "SUBSURF":
                        mod.levels = mod.render_levels
                if label.startswith("Garment-"):
                    parts[label].data.shade_smooth()
        # Fitted assets may add masks that hide skin under them. Every hairstyle is worn at
        # once here, so drop those masks: the body must keep the same vertices in every capture.
        for mod in list(basemesh.modifiers):
            if mod.type == "MASK" and mod.name != "Hide helpers":
                basemesh.modifiers.remove(mod)
        HumanService.refit(basemesh)
    return basemesh, parts


def evaluated_coords(obj):
    """World-space vertex positions after shape keys and the helper mask."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    mesh = ev.to_mesh()
    mw = obj.matrix_world
    coords = [mw @ v.co for v in mesh.vertices]
    ev.to_mesh_clear()
    return coords


BODY_VERTS = []


def capture(macros, targets, with_parts):
    basemesh, parts = build_human(macros, targets, with_parts)
    out = {"Body": evaluated_coords(basemesh)}
    BODY_VERTS.append(len(out["Body"]))
    if len(set(BODY_VERTS)) != 1:
        raise RuntimeError(f"Body vertex count changed between captures: {sorted(set(BODY_VERTS))}")
    for label, obj in parts.items():
        out[label] = evaluated_coords(obj)
    floor = min(v.z for v in out["Body"])
    for coords in out.values():
        for v in coords:
            v.z -= floor
    return out


def baked_copy(obj, name):
    """A plain mesh copy of obj as evaluated (shape keys applied, helpers removed),
    keeping vertex groups for skinning."""
    for mod in obj.modifiers:
        if mod.type == "ARMATURE":
            mod.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    mesh.name = name
    copy = bpy.data.objects.new(name, mesh)
    copy.matrix_world = obj.matrix_world.copy()
    bpy.context.scene.collection.objects.link(copy)
    for mod in obj.modifiers:
        if mod.type == "ARMATURE":
            mod.show_viewport = True
    return copy


def material(name, rgb, roughness=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def add_morphs(obj, base, variants):
    """Morph targets for one part, skipping any control that doesn't move it
    (hair has no use for the waist), which keeps the file small."""
    obj.shape_key_add(name="Basis", from_mix=False)
    for name, coords in variants.items():
        if obj.name != "Body" and max((v - b).length for b, v in zip(base, coords)) < 1e-4:
            continue
        key = obj.shape_key_add(name=name, from_mix=False)
        for i, (b, v) in enumerate(zip(base, coords)):
            key.data[i].co = obj.data.vertices[i].co + (v - b)


def face_landmarks(body_coords, body_obj):
    """Upper-lip anchor for mustaches: the front-most vertex just above the mouth,
    found from MPFB's own mouth area via the base mesh geometry."""
    zs = [v.z for v in body_coords]
    top = max(zs)
    head = [v for v in body_coords if v.z > top - 0.25 and abs(v.x) < 0.09]
    front_y = min(v.y for v in head)  # MPFB faces -Y
    nose_tip = min(head, key=lambda v: v.y)
    lip_band = [v for v in head if nose_tip.z - 0.045 < v.z < nose_tip.z - 0.02 and abs(v.x) < 0.03]
    lip = min(lip_band, key=lambda v: v.y) if lip_band else nose_tip - Vector((0, 0, 0.03))
    return {"nose_tip": nose_tip, "upper_lip": lip, "front_y": front_y}


MUSTACHES = {
    # name: (half width, droop at the ends, thickness, end curl)
    "chevron": (0.026, 0.006, 0.006, 0.0),
    "pencil": (0.022, 0.001, 0.0022, 0.0),
    "handlebar": (0.034, -0.008, 0.004, 1.0),
    "walrus": (0.032, 0.012, 0.010, 0.0),
    "horseshoe": (0.030, 0.040, 0.005, 0.0),
}


def make_mustache(style, anchor, body_tree, body_coords):
    """A low-poly mustache strip hugging the upper lip."""
    half, droop, thick, curl = MUSTACHES[style]
    bm = bmesh.new()
    steps = 14
    rows = []
    for i in range(steps + 1):
        t = i / steps * 2 - 1  # -1..1 across the lip
        x = anchor.x + t * half
        z = anchor.z + 0.004 - abs(t) ** 1.6 * droop
        if curl and abs(t) > 0.75:
            k = (abs(t) - 0.75) / 0.25
            z += curl * 0.012 * k * k
        if style == "horseshoe" and abs(t) > 0.8:
            z = anchor.z - (abs(t) - 0.8) / 0.2 * droop
        # sit just in front of the skin: the front-most face vertex near (x, z)
        near = [v.y for v in body_coords if abs(v.x - x) < 0.006 and abs(v.z - z) < 0.006 and v.y < anchor.y + 0.04]
        y = (min(near) if near else anchor.y) - 0.003
        h = thick * (1 - 0.55 * abs(t) ** 2) + 0.0015
        rows.append([
            bm.verts.new((x, y, z + h * 0.5)),
            bm.verts.new((x, y - h * 0.6, z)),
            bm.verts.new((x, y, z - h * 0.5)),
        ])
    for a, b in zip(rows, rows[1:]):
        for j in range(2):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
        bm.faces.new((a[2], b[2], b[0], a[0]))
    mesh = bpy.data.meshes.new(f"Mustache-{style}")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(f"Mustache-{style}", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def follow_body(obj, body_obj, body_base, body_variants, body_tree):
    """Give a rigid accessory the body's morphs: each vertex copies the offset of
    the nearest body vertex, and inherits that vertex's skin weights."""
    near = [body_tree.find(v.co)[1] for v in obj.data.vertices]
    obj.shape_key_add(name="Basis", from_mix=False)
    for name, coords in body_variants.items():
        key = obj.shape_key_add(name=name, from_mix=False)
        for i, j in enumerate(near):
            key.data[i].co = obj.data.vertices[i].co + (coords[j] - body_base[j])
    groups = {g.index: g.name for g in body_obj.vertex_groups}
    for i, j in enumerate(near):
        for g in body_obj.data.vertices[j].groups:
            name = groups[g.group]
            vg = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
            vg.add([i], g.weight, "REPLACE")


def ring_circumference(coords, z, band=0.012, xlim=None):
    """Approximate tape-measure circumference of the torso at height z (convex hull)."""
    pts = [(v.x, v.y) for v in coords if abs(v.z - z) < band and (xlim is None or abs(v.x) < xlim)]
    if len(pts) < 3:
        return 0.0
    pts = sorted(set(pts))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    return sum(math.dist(hull[i], hull[(i + 1) % len(hull)]) for i in range(len(hull)))


def measure(coords):
    """Body measurements in cm, read at the same proportional heights the app uses."""
    H = max(v.z for v in coords)
    torso_x = 0.25 * H / 1.75
    shoulder = [v for v in coords if 0.80 * H < v.z < 0.84 * H]
    return {
        "heightCm": H * 100,
        "shoulderCm": (max(v.x for v in shoulder) - min(v.x for v in shoulder)) * 100,
        "chestCm": ring_circumference(coords, 0.73 * H, xlim=torso_x * 0.62) * 100,
        "waistCm": ring_circumference(coords, 0.615 * H, xlim=torso_x * 0.62) * 100,
        "hipCm": ring_circumference(coords, 0.51 * H, xlim=torso_x * 0.8) * 100,
        "inseamCm": crotch_height(coords) * 100,
    }


def crotch_height(coords):
    """Lowest point of the gap between the legs, found by scanning upwards."""
    H = max(v.z for v in coords)
    z = 0.30 * H
    while z < 0.6 * H:
        mid = [v for v in coords if abs(v.z - z) < 0.006 and abs(v.x) < 0.012]
        if mid:
            return z
        z += 0.004
    return 0.47 * H


def delete_verts(mhclo_path):
    """Body vertices (original MakeHuman numbering) that a garment hides, from its mhclo."""
    out, reading = set(), False
    with open(mhclo_path) as f:
        for line in f:
            if line.startswith("delete_verts"):
                reading = True
                continue
            if reading:
                tokens = line.split()
                if not tokens or not tokens[0].isdigit():
                    break
                i = 0
                while i < len(tokens):
                    if i + 2 < len(tokens) and tokens[i + 1] == "-":
                        out.update(range(int(tokens[i]), int(tokens[i + 2]) + 1))
                        i += 3
                    else:
                        out.add(int(tokens[i]))
                        i += 1
    return out


def add_hide_masks(objects):
    """One float attribute per garment on the export body (1 = skin the garment covers),
    so the app can hide that skin and it never pokes through.

    Measured, not taken from the garments' own delete lists: those were authored for
    MakeHuman's default body and are generous, so around straps, armholes and on other
    body shapes they open visible gaps. Here a ray goes out from every skin vertex along
    its normal; if it meets the garment within 4 cm (or the skin sits up to 3 cm outside
    the smoothed cloth), that skin is covered. One ring of
    vertices is then kept back at every edge so hems and straps never show a gap.
    Attributes survive the glTF export's vertex splitting, unlike indices."""
    from mathutils.bvhtree import BVHTree
    body = objects["Body"]
    mw = body.matrix_world
    normal_mw = mw.to_3x3().inverted().transposed()
    points = [mw @ v.co for v in body.data.vertices]
    normals = [(normal_mw @ v.normal).normalized() for v in body.data.vertices]
    # Level rays are for skirts hanging off the legs, so they're only cast from leg skin (below
    # the crotch, inside the legs' width): arms hang beside the hips in the rest pose, and a
    # level ray from a forearm would "find" the trousers next to it.
    crotch = crotch_height(points)
    on_leg = [p.z < crotch + 0.03 and abs(p.x) < 0.22 for p in points]
    print(f"[mannequin] {sum(on_leg)} leg skin vertices get level rays")
    neighbours = [[] for _ in body.data.vertices]
    for e in body.data.edges:
        a, b = e.vertices
        neighbours[a].append(b)
        neighbours[b].append(a)
    for label, obj in objects.items():
        if not label.startswith("Garment-"):
            continue
        key = label[len("Garment-"):]
        gw = obj.matrix_world
        tree = BVHTree.FromPolygons([gw @ v.co for v in obj.data.vertices], [list(p.vertices) for p in obj.data.polygons])
        # Out along the normal (cloth just outside the skin), and from 3 cm out to 3 cm in (skin
        # that ends up outside the cloth: subdivision pulls a garment's surface in by up to
        # ~2 cm on curves like the hips, and MPFB only matches that by smoothing the body too,
        # which would quadruple its size on phones).
        # Loose skirts and dresses hang away from the thighs in front, not along the skin's
        # own direction, so also try short level rays (front, back, sides) that roughly face
        # the same way as the skin.
        level = [Vector((1, 0, 0)), Vector((-1, 0, 0)), Vector((0, 1, 0)), Vector((0, -1, 0))]

        def is_covered(p, n, leg):
            if tree.ray_cast(p + n * 0.0005, n, 0.04)[0] is not None or tree.ray_cast(p + n * 0.03, -n, 0.06)[0] is not None:
                return True
            return leg and any(d.dot(n) > 0.5 and tree.ray_cast(p + d * 0.0005, d, 0.08)[0] is not None for d in level)

        covered = [is_covered(p, n, leg) for p, n, leg in zip(points, normals, on_leg)]
        kept = [c and all(covered[j] for j in neighbours[i]) for i, c in enumerate(covered)]
        attr = body.data.attributes.new(name=f"_HIDE_{key.upper()}", type="FLOAT", domain="POINT")
        attr.data.foreach_set("value", [1.0 if k else 0.0 for k in kept])
        print(f"[mannequin] {key} covers {sum(kept)} skin vertices")


def read_glb_attributes(path, node_name, names):
    """Float vertex attributes of one node's mesh, read straight from a .glb."""
    import struct
    with open(path, "rb") as f:
        data = f.read()
    length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    bin_start = 20 + length + 8
    node = next(n for n in gltf["nodes"] if n.get("name") == node_name and "mesh" in n)
    attrs = gltf["meshes"][node["mesh"]]["primitives"][0]["attributes"]
    out = {}
    for name in names:
        acc = gltf["accessors"][attrs[name]]
        view = gltf["bufferViews"][acc["bufferView"]]
        start = bin_start + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[acc["type"]]
        out[name] = struct.unpack_from(f"<{acc['count'] * width}f", data, start)  # float, tightly packed
    return out


def tintable_texture(src, dst, size=512, middle=None):
    """A grey-scale copy of a hair or garment texture, keeping its alpha, so the app can
    tint it to any colour. Brightness is stretched so the strands come out light grey;
    with `middle`, the median tone lands there instead, so a garment's baked shading
    stays as subtle detail and the tint reads as the garment's real colour."""
    import numpy as np
    img = bpy.data.images.load(src)
    img.scale(size, size)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    lum = px[:, :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    solid = px[:, 3] > 0.5
    if middle is None:
        top = np.percentile(lum[solid], 95) if solid.any() else 1.0
        lum = np.clip(lum / max(top, 1e-3) * 0.9, 0, 1)
    else:
        mid = np.median(lum[solid]) if solid.any() else 0.5
        lum = np.clip(middle + (lum - mid) * 0.6, 0, 1)
    px[:, 0] = px[:, 1] = px[:, 2] = lum
    out = bpy.data.images.new(os.path.basename(dst), size, size, alpha=True)
    out.pixels = px.ravel().tolist()
    out.filepath_raw = dst
    out.file_format = "PNG"
    out.save()
    bpy.data.images.remove(img)
    bpy.data.images.remove(out)


def export_textures():
    data = LocationService.get_user_data()
    os.makedirs(os.path.join(TEXTURES, "hair"), exist_ok=True)
    for h in ([] if BATCH else HAIR):
        folder = os.path.join(data, "hair", h)
        diffuse = next(f for f in os.listdir(folder) if f.endswith("_diffuse.png"))
        tintable_texture(os.path.join(folder, diffuse), os.path.join(TEXTURES, "hair", f"{h}.png"))
    if not BATCH:
        tintable_texture(os.path.join(data, "eyebrows", "eyebrow001", "eyebrow001.png"), os.path.join(TEXTURES, "eyebrows.png"))
    # Garment detail (seams, knit, folds) as grey-scale, tinted to each wardrobe item's colour in the app.
    os.makedirs(os.path.join(TEXTURES, "garments"), exist_ok=True)
    for key, (name, _) in GARMENTS.items():
        folder = os.path.join(data, "clothes", name)
        base = garment_texture(folder, "diffuseTexture") or next(
            (os.path.join(folder, f) for f in sorted(os.listdir(folder))
             if f.lower().endswith((".png", ".jpg")) and not any(t in f.lower() for t in ("norm", "nrml", "height", "rough", "thumb", "bump", "spec", "_ao"))), None)
        dst = os.path.join(TEXTURES, "garments", f"{key}.png")
        if base:
            tintable_texture(base, dst, size=1024, middle=0.92)
        else:  # no texture: plain cloth, tinted in the app
            plain = bpy.data.images.new(f"{key}.png", 4, 4, alpha=True)
            plain.pixels = [0.92, 0.92, 0.92, 1.0] * 16
            plain.filepath_raw = dst
            plain.file_format = "PNG"
            plain.save()
            bpy.data.images.remove(plain)
        # The garment's own normal map (weave, knit, stitching), as MPFB's material uses it.
        normal = garment_texture(folder, "normalmapTexture") or next(
            (os.path.join(folder, f) for f in sorted(os.listdir(folder)) if "norm" in f.lower() and f.lower().endswith(".png")), None)
        if normal:
            img = bpy.data.images.load(normal)
            img.scale(1024, 1024)
            img.filepath_raw = os.path.join(TEXTURES, "garments", f"{key}-normal.png")
            img.file_format = "PNG"
            img.save()
            bpy.data.images.remove(img)
    print(f"[mannequin] wrote tintable hair textures to {TEXTURES}")


def main():
    with_parts = os.path.exists(os.path.join(LocationService.get_user_data(), PARTS[0][1]))
    print(f"[mannequin] parts available: {with_parts}")

    variants = {}
    for i, (name, (macros, targets)) in enumerate(MORPHS.items()):
        variants[name] = capture(macros, targets, with_parts)
        print(f"[mannequin] {i + 1}/{len(MORPHS)} {name}")

    base_parts = capture({}, {}, with_parts)
    basemesh, parts = build_human({}, {}, with_parts)
    rig = HumanService.add_builtin_rig(basemesh, "default", import_weights=True)

    # Clean, export-ready objects with the skeleton's vertex groups.
    body = baked_copy(basemesh, "Body")
    floor = min((body.matrix_world @ v.co).z for v in body.data.vertices)
    objects = {"Body": body}
    for label, obj in parts.items():
        objects[label] = baked_copy(obj, label)
    for label, obj in objects.items():
        obj.location.z -= floor
    add_hide_masks(objects)
    for obj in (basemesh, *parts.values()):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()

    for label, obj in objects.items():
        add_morphs(obj, base_parts[label], {n: v[label] for n, v in variants.items()})

    # Materials: neutral mannequin, eyes with a tintable iris, dark hair.
    objects["Body"].data.materials.clear()
    objects["Body"].data.materials.append(material("Skin", (0.74, 0.74, 0.73), 0.55))
    hair = material("Hair", (0.08, 0.06, 0.05), 0.7)
    # Plain materials only: MPFB's own embed full-size textures, and the app supplies
    # small tintable ones (public/models) instead.
    for label in objects:
        if label in ("Eyebrows", "Eyelashes") or label.startswith(("Hair-", "Garment-")):
            objects[label].data.materials.clear()
            objects[label].data.materials.append(hair)
    if "Eyes" in objects:
        objects["Eyes"].data.materials.clear()
        objects["Eyes"].data.materials.append(material("Iris", (0.35, 0.22, 0.12), 0.3))

    # Mustaches follow the face morphs through the nearest skin vertex.
    body_base = base_parts["Body"]
    tree = KDTree(len(body_base))
    for i, v in enumerate(body_base):
        tree.insert(v, i)
    tree.balance()
    marks = face_landmarks(body_base, body)
    for style in ([] if BATCH else MUSTACHES):
        obj = make_mustache(style, marks["upper_lip"], tree, body_base)
        obj.data.materials.append(hair)
        follow_body(obj, body, body_base, {n: v["Body"] for n, v in variants.items()}, tree)
        objects[f"Mustache-{style}"] = obj

    # Skin everything to the skeleton.
    for obj in objects.values():
        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = rig
        obj.parent = rig
    rig.location.z -= floor

    # Calibration for the app: measurements of the base and each body morph.
    base_m = measure(body_base)
    meta = {
        "source": "MPFB 2.0.18 + MakeHuman system assets (CC0)",
        "base": base_m,
        "morphs": {},
        "parts": sorted(objects),
    }
    for name in ("female", "weight-min", "weight-max", "muscle-min", "muscle-max", "height-min", "height-max",
                 "shoulders-incr", "shoulders-decr", "chest-incr", "chest-decr", "waist-incr", "waist-decr",
                 "hips-incr", "hips-decr", "legs-incr", "legs-decr", "belly-incr", "belly-decr"):
        m = measure(variants[name]["Body"])
        meta["morphs"][name] = {k: round(m[k] - base_m[k], 2) for k in m}
    meta["base"] = {k: round(v, 2) for k, v in base_m.items()}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # The rig brings bone display shapes (an icosphere); only the mannequin's own parts ship.
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj not in objects.values():
            bpy.data.objects.remove(obj, do_unlink=True)

    def export(path, chosen, skins):
        for obj in bpy.context.scene.objects:
            obj.select_set(obj in chosen)
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_apply=False,
            export_morph=True,
            export_morph_normal=True,
            export_skins=skins,
            export_attributes=True,
            export_animations=False,
            export_yup=True,
        )

    # Garments ship one file each, so the app downloads only what's worn. They're placed in
    # the same world space as the body and carry the same morph names, so the app drives
    # them with the body's weights; the mannequin stands still, so no skin is needed.
    garment_dir = os.path.join(os.path.dirname(OUT), "garments")
    os.makedirs(garment_dir, exist_ok=True)
    meta["garments"] = {}
    for label, obj in objects.items():
        if not label.startswith("Garment-"):
            continue
        key = label[len("Garment-"):]
        obj.parent = None
        obj.matrix_world = obj.matrix_world.copy()
        export(os.path.join(garment_dir, f"{key}.raw.glb"), [obj], skins=False)
        folder = os.path.join(LocationService.get_user_data(), "clothes", GARMENTS[key][0])
        meta["garments"][key] = {
            "asset": GARMENTS[key][0],
            "normalMap": bool(garment_texture(folder, "normalmapTexture") or any("norm" in f.lower() and f.lower().endswith(".png") for f in os.listdir(folder))),
        }
        if BATCH:
            meta["garments"][key]["hideFile"] = True
    body_parts = [o for label, o in objects.items() if not label.startswith("Garment-")]
    if BATCH:
        # The mannequin isn't rebuilt. The body is exported exactly as for the mannequin, to a
        # scratch file, only to read each mask back in the glTF's own vertex order (the
        # exporter splits vertices at UV seams); each mask ships as <key>-hide.bin, one byte
        # per body vertex, loaded with the garment.
        scratch = os.path.join(garment_dir, "_body.raw.glb")
        export(scratch, body_parts + [rig], skins=True)
        masks = read_glb_attributes(scratch, "Body", ["POSITION"] + [f"_HIDE_{k.upper()}" for k in BATCH])
        os.remove(scratch)
        # The shipped mannequin was meshopt-compressed, which reorders vertices: match each of
        # its vertices to this export's by position (each set scaled to its own bounding box,
        # as meshopt also quantised the positions).
        import struct
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "body-order.f32"), "rb") as f:
            raw = f.read()
        shipped = struct.unpack(f"<{len(raw) // 4}f", raw)

        def boxed(flat):
            n = len(flat) // 3
            lo = [min(flat[a::3]) for a in range(3)]
            hi = [max(flat[a::3]) for a in range(3)]
            return [Vector([(flat[i * 3 + a] - lo[a]) / (hi[a] - lo[a]) for a in range(3)]) for i in range(n)]

        mine, theirs = boxed(masks["POSITION"]), boxed(shipped)
        tree = KDTree(len(mine))
        for i, v in enumerate(mine):
            tree.insert(v, i)
        tree.balance()
        match = [tree.find(v) for v in theirs]
        worst = max(d for _, _, d in match)
        print(f"[mannequin] matched {len(theirs)} shipped body vertices, worst {worst:.5f} of the body's size")
        if worst > 0.002:
            raise RuntimeError("body-order.f32 doesn't match this body: rebuild the mannequin first")
        for key in BATCH:
            values = masks[f"_HIDE_{key.upper()}"]
            with open(os.path.join(garment_dir, f"{key}-hide.bin"), "wb") as f:
                f.write(bytes(1 if values[j] > 0.5 else 0 for _, j, _ in match))
        with open(META) as f:
            full = json.load(f)
        full.setdefault("garments", {}).update(meta["garments"])
        meta = full
    else:
        export(OUT, body_parts + [rig], skins=True)
    os.makedirs(os.path.dirname(META), exist_ok=True)
    with open(META, "w") as f:
        json.dump(meta, f, indent=2)
    export_textures()
    print(f"[mannequin] wrote {OUT} and {META}")


main()
