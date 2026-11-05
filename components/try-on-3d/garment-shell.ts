import * as THREE from "three";
import type { Garment } from "@/components/try-on/garments";

/**
 * Garments for the MPFB mannequin, cut straight from its skin: the faces that
 * fall inside the garment's area are copied and pushed out along their
 * normals by the fit's ease. The copy shares the body's skeleton and morph
 * targets, so it follows every face and body slider with no refitting.
 */

const EASE_CM = { slim: 2, regular: 5, relaxed: 10 } as const;
/** Gap between skin and cloth in metres, from the circumference ease. */
export const easeFor = (g: Garment) => 0.004 + EASE_CM[g.fit] / (2 * Math.PI) / 100;

/** Body landmarks in metres on the neutral base body, derived like the 2D skeleton. */
export interface Landmarks {
  H: number;
  headH: number;
  chinY: number;
  shoulderY: number;
  chestY: number;
  waistY: number;
  hipY: number;
  crotchY: number;
  /** Shoulder joint (head of the upper-arm bone), left side (+x). */
  shoulder: THREE.Vector3;
}

export function landmarksOf({ world: rest, shoulder }: Rest, inseamM: number): Landmarks {
  let H = 0;
  for (let i = 1; i < rest.length; i += 3) H = Math.max(H, rest[i]);
  const headH = H / 7.8;
  const chinY = H - headH;
  return {
    H, headH, chinY,
    shoulderY: chinY - headH * 0.36,
    chestY: H * 0.73,
    waistY: H * 0.615,
    hipY: H * 0.51,
    crotchY: inseamM,
    shoulder,
  };
}

/**
 * Rest-pose positions in metres. The compressed model stores positions in a
 * -1..1 range and puts the way back to metres into the skeleton's bind
 * matrices, so positions are read through the skin exactly as three.js draws
 * them. `scale` converts metres back into the mesh's own units.
 */
export interface Rest {
  world: Float32Array;
  scale: number;
  /** 1 where a vertex is mostly skinned to arm or hand bones. */
  arm: Uint8Array;
  shoulder: THREE.Vector3;
}

const ARM_BONE = /^(upperarm|lowerarm|wrist|metacarpal|finger|thumb)/;

export function restPositions(mesh: THREE.Mesh): Rest {
  const pos = mesh.geometry.getAttribute("position");
  const world = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  let root: THREE.Object3D = mesh;
  while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
  // Skinned meshes keep the way back to metres in their bind matrices; plain ones in their node transform.
  const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : null;
  skinned?.skeleton.update();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (skinned) skinned.applyBoneTransform(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    world.set([v.x, v.y, v.z], i * 3);
  }
  // Rest pose maps mesh units to metres by one uniform scale; measure it on the tallest span.
  let top = 0, bottom = 0;
  for (let i = 0; i < pos.count; i++) {
    if (world[i * 3 + 1] > world[top * 3 + 1]) top = i;
    if (world[i * 3 + 1] < world[bottom * 3 + 1]) bottom = i;
  }
  const a = new THREE.Vector3().fromBufferAttribute(pos, top);
  const b = new THREE.Vector3().fromBufferAttribute(pos, bottom);
  const metres = new THREE.Vector3().fromArray(world, top * 3).distanceTo(new THREE.Vector3().fromArray(world, bottom * 3));

  const bones = skinned?.skeleton.bones ?? [];
  const armBone = bones.map((bone) => ARM_BONE.test(bone.name));
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  const arm = new Uint8Array(pos.count);
  if (skinned && skinIndex && skinWeight) {
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (armBone[skinIndex.getComponent(i, k)]) w += skinWeight.getComponent(i, k);
      arm[i] = w > 0.5 ? 1 : 0;
    }
  }
  const upperArm = bones.find((bone) => bone.name === "upperarm01.L");
  const shoulder = upperArm ? upperArm.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0.18, 1.4, 0);
  return { world, scale: a.distanceTo(b) / metres, arm, shoulder };
}

export interface Region {
  /** Whether a vertex is covered, and whether it's in a trim band (cuff, collar, waistband). */
  inside: (p: THREE.Vector3, arm: boolean) => boolean;
  trim?: (p: THREE.Vector3, arm: boolean) => boolean;
}

/** Which part of the body a garment covers, decided per vertex in rest pose. */
export function regionFor(g: Garment, k: Landmarks): Region {
  // Measured from the shoulder joint down the arm.
  const sleeveLen = g.sleeve === "long" ? 0.56 : g.fit === "relaxed" ? 0.19 : 0.15;
  const armDist = (p: THREE.Vector3) => Math.hypot(Math.abs(p.x) - k.shoulder.x, p.y - k.shoulder.y, p.z - k.shoulder.z);
  if (g.category === "top") {
    const hem = k.hipY - k.headH * (g.length === "low-hip" ? 0.48 : 0.3);
    const neck = g.neckline === "boat" ? k.shoulderY + k.headH * 0.08 : k.shoulderY + k.headH * 0.2;
    const cuff = g.sleeve === "long" ? 0.05 : 0.022;
    return {
      inside: (p, arm) => (arm ? armDist(p) < sleeveLen : p.y > hem && p.y < neck),
      trim: (p, arm) => (arm ? armDist(p) > sleeveLen - cuff : g.neckline !== "boat" && p.y > neck - (g.neckline === "polo-collar" ? 0.028 : 0.014)),
    };
  }
  const top = k.waistY - k.headH * 0.32;
  const hem = k.crotchY - 0.17;
  return {
    inside: (p, arm) => !arm && p.y > hem && p.y < top,
    trim: (p) => p.y > top - k.headH * 0.15,
  };
}

/**
 * Builds the cloth mesh(es): a copy of the body's skinned, morphed geometry
 * restricted to the region, offset along the normals, with fabric UVs in
 * metres (round the body, and up it) so prints tile at true size.
 */
export function cutGarment(body: THREE.SkinnedMesh, { world: rest, scale, arm }: Rest, region: Region, ease: number) {
  const src = body.geometry;
  const index = src.getIndex()!;
  const normal = src.getAttribute("normal");
  const position = src.getAttribute("position");
  const count = position.count;

  const inside = new Uint8Array(count);
  const trim = new Uint8Array(count);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    p.fromArray(rest, i * 3);
    inside[i] = region.inside(p, !!arm[i]) ? 1 : 0;
    trim[i] = inside[i] && region.trim?.(p, !!arm[i]) ? 1 : 0;
  }

  // Positions pushed out along the normal, in the mesh's own units so the skin still applies.
  const make = (extra: number) => {
    const pos = new Float32Array(count * 3);
    const n = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      n.fromBufferAttribute(normal, i).normalize();
      p.fromBufferAttribute(position, i).addScaledVector(n, (ease + extra) * scale);
      pos.set([p.x, p.y, p.z], i * 3);
    }
    return pos;
  };
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = rest[i * 3];
    const y = rest[i * 3 + 1];
    const z = rest[i * 3 + 2];
    uv[i * 2] = Math.atan2(x, z) * 0.16; // ~16 cm radius, so u is metres round the torso
    uv[i * 2 + 1] = y;
  }

  const build = (keep: (a: number, b: number, c: number) => boolean, extra: number) => {
    const faces: number[] = [];
    for (let f = 0; f < index.count; f += 3) {
      const a = index.getX(f), b = index.getX(f + 1), c = index.getX(f + 2);
      if (keep(a, b, c)) faces.push(a, b, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(make(extra), 3));
    geo.setAttribute("normal", normal);
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setAttribute("skinIndex", src.getAttribute("skinIndex"));
    geo.setAttribute("skinWeight", src.getAttribute("skinWeight"));
    // Morph deltas are in the same mesh space, so the body's own targets fit the cloth too.
    geo.morphAttributes = src.morphAttributes;
    geo.morphTargetsRelative = src.morphTargetsRelative;
    geo.setIndex(faces);
    geo.boundingSphere = src.boundingSphere;
    return geo;
  };

  const all = (a: number, b: number, c: number) => !!(inside[a] && inside[b] && inside[c]);
  const isTrim = (a: number, b: number, c: number) => all(a, b, c) && !!(trim[a] || trim[b] || trim[c]);
  return {
    cloth: build((a, b, c) => all(a, b, c) && !isTrim(a, b, c), 0),
    // Trim sits a hair proud of the cloth so cuffs and waistbands read as separate bands.
    trim: region.trim ? build(isTrim, 0.0015) : null,
  };
}

/** Which vertices touch which, from a mesh's triangles. */
export function adjacencyOf(geometry: THREE.BufferGeometry) {
  const count = geometry.getAttribute("position").count;
  const index = geometry.getIndex()!;
  const sets: Set<number>[] = Array.from({ length: count }, () => new Set());
  for (let f = 0; f < index.count; f += 3) {
    const a = index.getX(f), b = index.getX(f + 1), c = index.getX(f + 2);
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  return sets.map((s) => Uint32Array.from(s));
}

/**
 * Skin a garment covers, so the body can hide it and never poke through.
 * MakeHuman garments use the coverage the build measured (`measured`, from the
 * garment's own file, or a "_hide_<model>" attribute on the body); others fall back to the garment's area, shrunk by a
 * few vertex rings so skin right at the hems and cuffs stays visible.
 */
export function coveredSkin(body: THREE.SkinnedMesh, rest: Rest, marks: Landmarks, g: Garment, adjacency: Uint32Array[], measured?: Uint8Array | null) {
  const count = rest.world.length / 3;
  if (measured?.length === count) return measured;
  const mask = new Uint8Array(count);
  const listed = g.model ? body.geometry.getAttribute(`_hide_${g.model}`) : undefined;
  if (listed) {
    for (let i = 0; i < count; i++) if (listed.getX(i) > 0.5) mask[i] = 1;
    return mask;
  }
  const region = regionFor(g, marks);
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) mask[i] = region.inside(p.fromArray(rest.world, i * 3), !!rest.arm[i]) ? 1 : 0;
  for (let ring = 0; ring < 3; ring++) {
    const edge: number[] = [];
    for (let i = 0; i < count; i++) if (mask[i] && adjacency[i].some((j) => !mask[j])) edge.push(i);
    for (const i of edge) mask[i] = 0;
  }
  return mask;
}

/** World position of one vertex with the current morphs and skin applied, as the GPU draws it (for logos and buttons). */
export function morphedVertex(body: THREE.Mesh, i: number, out = new THREE.Vector3()) {
  return body.getVertexPosition(i, out).applyMatrix4(body.matrixWorld);
}

/** The front-most body vertex near (x, y): where a chest logo or placket sits. */
export function frontVertex({ world: rest }: Rest, x: number, y: number) {
  let best = -1;
  let bestZ = -Infinity;
  for (let i = 0; i < rest.length / 3; i++) {
    const vx = rest[i * 3], vy = rest[i * 3 + 1], vz = rest[i * 3 + 2];
    if (Math.abs(vx - x) < 0.012 && Math.abs(vy - y) < 0.012 && vz > bestZ) {
      bestZ = vz;
      best = i;
    }
  }
  return best;
}
