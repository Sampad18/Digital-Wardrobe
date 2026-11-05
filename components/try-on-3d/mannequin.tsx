"use client";

import * as React from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import type { BodyMeasurements } from "@/components/try-on/body";
import type { Garment } from "@/components/try-on/garments";
import { EYE_COLORS, HAIR_COLORS, HAIR_STYLES, morphWeights, type Appearance, type EyeColor, type HairColor, type HairStyle } from "./appearance";
import { fabricFor, ribFor } from "./fabric";
import { adjacencyOf, coveredSkin, cutGarment, easeFor, frontVertex, landmarksOf, morphedVertex, regionFor, restPositions, type Landmarks, type Rest } from "./garment-shell";
import meta from "./mannequin-meta.json";
import { bodySurface, ClothSim } from "./drape";

/** Built by tools/mpfb/build.sh: one MPFB body with every control as a morph target. */
export const MANNEQUIN_URL = "/models/mannequin.glb";
// No Draco (no CDN decoder needed); meshopt decodes in the browser from three-stdlib.
useGLTF.preload(MANNEQUIN_URL, false, true);
/** MakeHuman's grey eye texture (CC0), recoloured per eye colour. */
const EYE_BASE_URL = "/models/eye-base.png";
const IRISES = [[0.29, 0.71], [0.71, 0.29]] as const;

/**
 * The loaded MPFB model plus the materials it wears. Owns all the three.js
 * mutation (morph weights, colours, which mustache shows), so components only
 * call its methods.
 */
class MannequinRig {
  readonly scene: THREE.Group;
  readonly meshes: THREE.Mesh[] = [];
  readonly body: THREE.SkinnedMesh | undefined;
  private skin = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 });
  private hair = new THREE.MeshStandardMaterial({ color: "#2A211C", roughness: 0.8, side: THREE.DoubleSide });
  private eyes = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0 });
  // Brows and lashes are see-through cards: their MakeHuman textures carry the hair strands.
  private brows = strands("/models/eyebrows.png");
  private lashes = strands("/models/eyelashes.png");
  // One cut-out material per hairstyle, each with its grey-scale texture tinted by the hair colour.
  private hairStyles = new Map<string, THREE.MeshStandardMaterial>(
    (Object.keys(HAIR_STYLES) as HairStyle[]).filter((h) => h !== "none").map((h) => [h, strands(`/models/hair/${h}.png`, true)]),
  );

  constructor(source: THREE.Object3D) {
    // Cloned so the landing preview and the fitting room never share morph state.
    this.scene = SkeletonUtils.clone(source) as THREE.Group;
    this.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.meshes.push(o as THREE.Mesh); });
    // MPFB's exported materials are replaced with the app's own.
    for (const mesh of this.meshes) {
      const part = partOf(mesh);
      const style = part.startsWith("Hair-") ? this.hairStyles.get(part.slice(5)) : undefined;
      mesh.material = style ?? { Eyes: this.eyes, Body: this.skin, Eyebrows: this.brows, Eyelashes: this.lashes }[part] ?? this.hair;
      mesh.castShadow = part === "Body";
      mesh.receiveShadow = part === "Body";
      mesh.frustumCulled = false; // morphs move vertices outside the rest-pose bounds
    }
    this.body = this.meshes.find((m) => partOf(m) === "Body") as THREE.SkinnedMesh | undefined;
    // The clone shares the loaded body's geometry with every other copy of the model (and
    // with React's double render in development). Hiding skin rewrites the triangle list,
    // so this copy gets its own geometry that shares the heavy vertex data but owns its
    // index; the loaded original is never touched and the bare mannequin is always whole.
    if (this.body) {
      const shared = this.body.geometry;
      const own = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(shared.attributes)) own.setAttribute(name, attribute);
      own.morphAttributes = shared.morphAttributes;
      own.morphTargetsRelative = shared.morphTargetsRelative;
      own.setIndex(shared.getIndex()!.clone());
      own.boundingBox = shared.boundingBox;
      own.boundingSphere = shared.boundingSphere;
      this.body.geometry = own;
    }
    this.fullIndex = this.body?.geometry.getIndex()?.array.slice() ?? null;
    // Cloth collides with the whole body, including skin hidden under the clothes.
    if (this.body) this.body.userData.fullIndex = this.fullIndex;
  }

  private fullIndex: ArrayLike<number> | null;

  /** Hides body triangles whose three corners are all covered by worn clothes. */
  hideSkin(mask: Uint8Array | null) {
    if (!this.body || !this.fullIndex) return;
    const all = this.fullIndex;
    const keep: number[] = [];
    for (let f = 0; f < all.length; f += 3) {
      const a = all[f], b = all[f + 1], c = all[f + 2];
      if (!(mask && mask[a] && mask[b] && mask[c])) keep.push(a, b, c);
    }
    this.body.geometry.setIndex(keep);
  }

  applyWeights(w: Record<string, number>) {
    for (const mesh of this.meshes) {
      const dict = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (dict && influences) for (const [name, i] of Object.entries(dict)) influences[i] = w[name] ?? 0;
    }
  }

  setSkin(color: string) {
    this.skin.color.set(color);
  }

  /**
   * MakeHuman's grey eye texture with the irises recoloured. Both eyes share one
   * image; the irises sit at these UV centres.
   */
  setEyes(color: EyeColor) {
    const img = new Image();
    img.src = EYE_BASE_URL;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    img.onload = () => {
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, 512, 512);
      ctx.globalCompositeOperation = "color";
      ctx.fillStyle = EYE_COLORS[color];
      for (const [u, v] of IRISES) {
        ctx.beginPath();
        ctx.arc(u * 512, v * 512, 0.118 * 512, 0, Math.PI * 2);
        ctx.fill();
      }
      tex.needsUpdate = true;
    };
    this.eyes.map?.dispose();
    this.eyes.map = tex;
    this.eyes.needsUpdate = true;
  }

  /** Hair, eyebrows and mustache share one colour. */
  setHairColor(color: HairColor) {
    for (const m of [this.hair, this.brows, ...this.hairStyles.values()]) m.color.set(HAIR_COLORS[color]);
  }

  showHair(style: HairStyle) {
    for (const mesh of this.meshes) {
      const part = partOf(mesh);
      if (part.startsWith("Hair-")) mesh.visible = part === `Hair-${style}`;
    }
  }

  showMustache(style: string) {
    for (const mesh of this.meshes) {
      const part = partOf(mesh);
      if (part.startsWith("Mustache-")) mesh.visible = part === `Mustache-${style}`;
    }
  }

  dispose() {
    for (const m of [this.skin, this.hair, this.eyes, this.brows, this.lashes, ...this.hairStyles.values()]) {
      m.map?.dispose();
      m.dispose();
    }
  }
}

/**
 * Materials for strand textures. Brows and lashes are thin and blend softly;
 * hair is layered cards, so it's cut out at the alpha edge instead, which keeps
 * the layers sorting correctly from every angle.
 */
function strands(url: string, cutout = false) {
  const map = new THREE.TextureLoader().load(url);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  return cutout
    ? new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, roughness: 0.7, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ map, transparent: true, alphaTest: 0.2, depthWrite: false, roughness: 0.8, side: THREE.DoubleSide });
}

export function RealMannequin({ appearance, body, top, bottom, drape = false }: {
  appearance: Appearance; body: BodyMeasurements; top: Garment | null; bottom: Garment | null;
  /** Let the top fall onto the body with cloth physics instead of hugging it. */
  drape?: boolean;
}) {
  const gltf = useGLTF(MANNEQUIN_URL, false, true);
  const rig = React.useMemo(() => new MannequinRig(gltf.scene), [gltf.scene]);
  React.useEffect(() => () => rig.dispose(), [rig]);
  React.useEffect(() => rig.setSkin(body.skin), [rig, body.skin]);
  React.useEffect(() => rig.setEyes(appearance.eyes.color), [rig, appearance.eyes.color]);
  React.useLayoutEffect(() => rig.showMustache(appearance.mustache), [rig, appearance.mustache]);
  React.useLayoutEffect(() => rig.showHair(appearance.hair), [rig, appearance.hair]);
  React.useEffect(() => rig.setHairColor(appearance.hairColor), [rig, appearance.hairColor]);
  // Applied while rendering (not in an effect) so the polo's logo and buttons, which
  // read the morphed chest during their own render, always see the current shape.
  const weights = React.useMemo(() => {
    const w = morphWeights(appearance, body);
    rig.applyWeights(w);
    return w;
  }, [rig, appearance, body]);
  const { scene } = rig;
  const adjacency = React.useMemo(() => (rig.body ? adjacencyOf(rig.body.geometry) : null), [rig]);

  const skinned = rig.body;
  const rest = React.useMemo(() => (skinned ? restPositions(skinned) : null), [skinned]);
  const marks = React.useMemo(() => (rest ? landmarksOf(rest, meta.base.inseamCm / 100) : null), [rest]);
  // A top worn over shorts must clear the shorts' ease at the waistband.
  const bottomEase = bottom ? easeFor(bottom) : 0;
  const topEase = top ? Math.max(easeFor(top), bottom ? bottomEase + 0.007 : 0) : 0;

  // Skin under MakeHuman garments is hidden so it can't poke through at extreme shapes,
  // but only once each garment has loaded, so the body never shows a gap while it downloads.
  const [loaded, setLoaded] = React.useState<Record<string, Uint8Array | null>>({});
  const onLoaded = React.useCallback((id: string, on: boolean, hide: Uint8Array | null = null) => {
    setLoaded((cur) => {
      if (on) return { ...cur, [id]: hide };
      const rest = { ...cur };
      delete rest[id];
      return rest;
    });
  }, []);
  React.useLayoutEffect(() => {
    if (!skinned || !rest || !marks || !adjacency) return;
    const worn = [top, bottom].filter((g): g is Garment => !!g?.model && g.id in loaded);
    if (!worn.length) return;
    const masks = worn.map((g) => coveredSkin(skinned, rest, marks, g, adjacency, loaded[g.id]));
    const combined = new Uint8Array(masks[0].length);
    for (const m of masks) for (let i = 0; i < m.length; i++) combined[i] |= m[i];
    rig.hideSkin(combined);
    return () => rig.hideSkin(null);
  }, [rig, skinned, rest, marks, adjacency, top, bottom, loaded]);

  return (
    <>
      <primitive object={scene} />
      {skinned && rest && marks && bottom && (bottom.model
        ? <React.Suspense fallback={null}><ModelGarment key={bottom.id} g={bottom} marks={marks} weights={weights} onLoaded={onLoaded} body={drape ? skinned : undefined} /></React.Suspense>
        : <Cloth key={bottom.id} body={skinned} rest={rest} marks={marks} g={bottom} ease={bottomEase} weights={weights} />)}
      {skinned && rest && marks && top && (top.model
        ? <React.Suspense fallback={null}><ModelGarment key={top.id} g={top} marks={marks} weights={weights} onLoaded={onLoaded} body={drape ? skinned : undefined} over={bottom && !top.covers ? marks.waistY : undefined} /></React.Suspense>
        : drape
          ? <DrapedCloth key={top.id} body={skinned} rest={rest} marks={marks} g={top} ease={topEase} weights={weights} under={bottom ? bottomEase : 0} />
          : <Cloth key={top.id} body={skinned} rest={rest} marks={marks} g={top} ease={topEase} weights={weights} />)}
    </>
  );
}

/**
 * A wardrobe item worn as its MakeHuman garment: a real, closed garment fitted to
 * this body by MPFB, which follows every slider. It's tinted to the item's colour
 * over its own grey-scale detail texture (seams, knit, folds), or printed with the
 * item's pattern, and the item's logo is placed on its chest.
 */
function ModelGarment({ g, marks, weights, onLoaded, body, over }: {
  g: Garment; marks: Landmarks; weights: Record<string, number>;
  /** Told when this garment is on screen (and when it's taken off), so covered skin can hide. */
  onLoaded: (id: string, on: boolean, hide?: Uint8Array | null) => void;
  /** With physics drape on: the body the garment settles onto. */
  body?: THREE.SkinnedMesh;
  /** A top worn over a bottom: below this height it keeps clear of the bottom's waistband. */
  over?: number;
}) {
  const gltf = useGLTF(`/models/garments/${g.model}.glb`, false, true);
  const info = (meta.garments as Record<string, { hideFile?: boolean }>)[g.model!];
  const hide = info?.hideFile ? React.use(hideMask(g.model!)) : null;
  const worn = React.useMemo(() => new WornGarment(gltf.scene, g), [gltf.scene, g]);
  React.useEffect(() => () => worn.dispose(), [worn]);
  React.useLayoutEffect(() => {
    onLoaded(g.id, true, hide);
    return () => onLoaded(g.id, false);
  }, [g.id, onLoaded, hide]);
  // Driven by the body's weights, like the rig, so the cloth always matches the body.
  React.useMemo(() => worn.applyWeights(weights), [worn, weights]);
  // Physics drape: start from the MPFB fit and let gravity settle it. Re-dropped whenever
  // the body changes (weights is a dependency on purpose).
  const drape = React.useMemo(() => (body && worn.mesh ? new GarmentDrape(worn.mesh, body, g, worn.surfaceMaterial, over) : null), [body, worn, g, weights, over]);
  React.useEffect(() => () => drape?.dispose(), [drape]);
  useFrame(() => drape?.step());

  return (
    <>
      {drape ? <primitive object={drape.mesh} /> : <primitive object={worn.scene} />}
      {worn.mesh && g.logo ? <GarmentLogo mesh={worn.mesh} g={g} marks={marks} weights={weights} follow={drape} /> : null}
    </>
  );
}

/**
 * Skin a template garment covers, measured by the build (<model>-hide.bin: one byte per
 * body vertex). Garments built with the mannequin carry this on the body instead.
 */
const hideMasks = new Map<string, Promise<Uint8Array>>();
function hideMask(model: string) {
  let mask = hideMasks.get(model);
  if (!mask) {
    mask = fetch(`/models/garments/${model}-hide.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${model}-hide.bin: ${r.status}`))))
      .then((b) => new Uint8Array(b));
    hideMasks.set(model, mask);
  }
  return mask;
}

/**
 * A MakeHuman garment settling onto the body under gravity (XPBD, see drape.ts).
 * It starts from MPFB's fit, so it's already closed and in place; physics only adds
 * the hang and the folds. Seams the file splits for its UVs are welded back into one
 * particle so the cloth can't tear; bottoms keep their waistband pinned, as a real
 * waistband grips the waist; tops and dresses are held up by the shoulders.
 */
class GarmentDrape {
  readonly mesh: THREE.Mesh;
  private sim: ClothSim;
  private particle: Uint32Array;
  private position: THREE.BufferAttribute;

  constructor(source: THREE.Mesh, body: THREE.SkinnedMesh, g: Garment, material: THREE.Material, over?: number) {
    const count = source.geometry.getAttribute("position").count;
    const world = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    source.updateWorldMatrix(true, false);
    for (let i = 0; i < count; i++) {
      source.getVertexPosition(i, v).applyMatrix4(source.matrixWorld);
      world.set([v.x, v.y, v.z], i * 3);
    }
    // Weld vertices the file split along UV seams (same place, 0.1 mm grid).
    const ids = new Map<string, number>();
    this.particle = new Uint32Array(count);
    const start: number[] = [];
    for (let i = 0; i < count; i++) {
      const k = `${Math.round(world[i * 3] * 1e4)},${Math.round(world[i * 3 + 1] * 1e4)},${Math.round(world[i * 3 + 2] * 1e4)}`;
      let id = ids.get(k);
      if (id === undefined) { id = start.length / 3; ids.set(k, id); start.push(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]); }
      this.particle[i] = id;
    }
    const index = source.geometry.getIndex()!;
    const faces: number[] = [];
    for (let f = 0; f < index.count; f += 3) {
      const a = this.particle[index.getX(f)], b = this.particle[index.getX(f + 1)], c = this.particle[index.getX(f + 2)];
      if (a !== b && b !== c && a !== c) faces.push(a, b, c);
    }
    const startPos = Float32Array.from(start);

    // The cloth only collides with skin it's near (within 6 cm), so loose hands can't shove a hem.
    const surface = bodySurface(body);
    const cell = 0.06;
    const occupied = new Set<string>();
    for (let i = 0; i < startPos.length; i += 3) occupied.add(`${Math.floor(startPos[i] / cell)},${Math.floor(startPos[i + 1] / cell)},${Math.floor(startPos[i + 2] / cell)}`);
    const near = (b: number) => {
      const x = Math.floor(surface.pos[b * 3] / cell), y = Math.floor(surface.pos[b * 3 + 1] / cell), z = Math.floor(surface.pos[b * 3 + 2] / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (occupied.has(`${x + dx},${y + dy},${z + dz}`)) return true;
      return false;
    };
    let top = -Infinity;
    for (let i = 1; i < startPos.length; i += 3) top = Math.max(top, startPos[i]);
    const waistband = g.category === "bottom" && !g.covers ? top - 0.03 : Infinity;

    // Fitted garments keep their MPFB shape; loose ones are let go to hang and fold.
    const loose = !!g.covers || g.fit === "relaxed";
    const fitCompliance = loose ? 4e-4 : g.fit === "slim" ? 2e-6 : 2e-5;
    // Over a bottom, the top keeps 1.8 cm off the skin below the waist, so its hem lies
    // over the waistband instead of passing through it (cloth doesn't collide with cloth).
    const thickness = (b: number) => (over !== undefined && surface.pos[b * 3 + 1] < over ? 0.018 : 0.004);
    this.sim = new ClothSim(surface, {
      faces,
      start: startPos,
      ease: 0,
      drop: 0,
      bendCompliance: 2e-5,
      friction: 0.7,
      thickness,
      touches: near,
      pinned: (p) => startPos[p * 3 + 1] > waistband,
      fitCompliance,
    });

    const geometry = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.position.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", this.position);
    geometry.setAttribute("uv", source.geometry.getAttribute("uv"));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.copy();
  }

  /** World position of one garment vertex on the draped cloth. */
  vertex(i: number, out = new THREE.Vector3()) {
    const p = this.particle[i] * 3;
    return out.set(this.sim.pos[p], this.sim.pos[p + 1], this.sim.pos[p + 2]);
  }

  step() {
    if (this.sim.settled) return;
    this.sim.step(10);
    this.copy();
  }

  private copy() {
    const out = this.position.array as Float32Array;
    for (let i = 0; i < this.particle.length; i++) {
      const p = this.particle[i] * 3;
      out[i * 3] = this.sim.pos[p];
      out[i * 3 + 1] = this.sim.pos[p + 1];
      out[i * 3 + 2] = this.sim.pos[p + 2];
    }
    this.position.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  dispose() {
    this.mesh.geometry.dispose();
  }
}

/**
 * One loaded garment file, dressed as a wardrobe item: tinted to its colour over the
 * garment's own grey-scale detail texture (or printed with its pattern), with the
 * garment's normal map when it ships one, as in MPFB's material.
 */
class WornGarment {
  readonly scene: THREE.Object3D;
  readonly mesh: THREE.Mesh | undefined;
  private material: THREE.MeshStandardMaterial;

  constructor(source: THREE.Object3D, g: Garment) {
    this.scene = source.clone(true);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !this.mesh) (this as { mesh: THREE.Mesh | undefined }).mesh = m;
    });
    let map: THREE.Texture;
    if (g.pattern) {
      // Pattern tiles are sized for metres; MakeHuman UVs span about half a metre of cloth per unit.
      map = fabricFor(g);
      map.repeat.multiplyScalar(0.45);
    } else {
      map = new THREE.TextureLoader().load(`/models/garments/${g.model}.png`);
      map.colorSpace = THREE.SRGBColorSpace;
    }
    map.flipY = false;
    const info = (meta.garments as Record<string, { normalMap: boolean }>)[g.model!];
    const normalMap = info?.normalMap ? new THREE.TextureLoader().load(`/models/garments/${g.model}-normal.png`) : null;
    if (normalMap) normalMap.flipY = false;
    this.material = new THREE.MeshStandardMaterial({
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      color: g.pattern ? "#ffffff" : g.color,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    if (this.mesh) {
      this.mesh.material = this.material;
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
      this.mesh.frustumCulled = false;
      // Cloned meshes share the loaded morph array; give this one its own.
      if (this.mesh.morphTargetInfluences) this.mesh.morphTargetInfluences = this.mesh.morphTargetInfluences.slice();
    }
  }

  applyWeights(w: Record<string, number>) {
    const dict = this.mesh?.morphTargetDictionary;
    const influences = this.mesh?.morphTargetInfluences;
    if (dict && influences) for (const [name, i] of Object.entries(dict)) influences[i] = w[name] ?? 0;
  }

  /** The garment's material, shared with its physics-draped copy. */
  get surfaceMaterial() {
    return this.material;
  }

  dispose() {
    this.material.map?.dispose();
    this.material.normalMap?.dispose();
    this.material.dispose();
  }
}

/** The item's logo on the left chest of the worn garment, following its morphs. */
function GarmentLogo({ mesh, g, marks, weights, follow }: {
  mesh: THREE.Mesh; g: Garment; marks: Landmarks; weights: Record<string, number>;
  /** When the garment is physics-draped, the logo rides on the moving cloth instead. */
  follow?: GarmentDrape | null;
}) {
  const width = (g.logo?.widthCm ?? 9) / 100;
  const anchor = React.useMemo(() => frontVertex(restPositions(mesh), 0.035 + width / 2, marks.shoulderY - marks.headH * 0.32 - 0.012), [mesh, width, marks]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const position = React.useMemo(() => {
    const p = morphedVertex(mesh, anchor);
    p.z += 0.0025;
    return p.toArray() as THREE.Vector3Tuple;
  }, [mesh, anchor, weights]);
  const group = React.useRef<THREE.Group>(null);
  useFrame(() => {
    if (!follow || !group.current || anchor < 0) return;
    follow.vertex(anchor, group.current.position);
    group.current.position.z += 0.0025;
  });
  if (anchor < 0 || !g.logo) return null;
  return (
    <group ref={group} position={position}>
      <React.Suspense fallback={null}>
        <Logo src={g.logo.src} width={width} position={[0, 0, 0]} />
      </React.Suspense>
    </group>
  );
}

/** One garment cut from the body's skin; shares its skeleton and morph state. */
function Cloth({ body, rest, marks, g, ease, weights }: {
  body: THREE.SkinnedMesh; rest: Rest; marks: Landmarks; g: Garment; ease: number; weights: Record<string, number>;
}) {
  // Built, attached and torn down in one effect: whatever this garment added is
  // removed before the next one goes on, so swapping never stacks clothes.
  React.useLayoutEffect(() => {
    const { cloth, trim } = cutGarment(body, rest, regionFor(g, marks), ease);
    const fabric = new THREE.MeshStandardMaterial({ map: fabricFor(g), roughness: 0.92, side: THREE.DoubleSide });
    const rib = new THREE.MeshStandardMaterial({ map: ribFor(g.trim), roughness: 0.92, side: THREE.DoubleSide });
    const meshes = [new THREE.SkinnedMesh(cloth, fabric), ...(trim ? [new THREE.SkinnedMesh(trim, rib)] : [])];
    for (const m of meshes) {
      m.bind(body.skeleton, body.bindMatrix);
      // Same arrays as the body: every slider move reshapes the cloth too.
      m.morphTargetInfluences = body.morphTargetInfluences;
      m.morphTargetDictionary = body.morphTargetDictionary;
      m.position.copy(body.position);
      m.quaternion.copy(body.quaternion);
      m.scale.copy(body.scale);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      body.parent?.add(m);
    }
    return () => {
      for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); }
      for (const mat of [fabric, rib]) { mat.map?.dispose(); mat.dispose(); }
    };
  }, [body, rest, marks, g, ease]);

  return g.neckline === "polo-collar" ? <PoloDetails g={g} body={body} rest={rest} marks={marks} ease={ease} weights={weights} /> : null;
}

/**
 * A top that falls onto the body under gravity (XPBD, see drape.ts) and settles
 * in about a second and a half. Re-dropped whenever the body or garment changes.
 */
function DrapedCloth({ body, rest, marks, g, ease, weights, under }: {
  body: THREE.SkinnedMesh; rest: Rest; marks: Landmarks; g: Garment; ease: number; weights: Record<string, number>; under: number;
}) {
  const live = React.useRef<{ sim: ClothSim; position: THREE.BufferAttribute; whole: THREE.BufferGeometry } | null>(null);

  React.useLayoutEffect(() => {
    const surface = bodySurface(body);
    const { cloth, trim } = cutGarment(body, rest, regionFor(g, marks), ease);
    const clothFaces = cloth.getIndex()!.array;
    const trimFaces = trim?.getIndex()?.array ?? [];
    // Skin under the shorts' waistband sits further out, so the top drapes over the shorts.
    const shortsTop = marks.waistY - marks.headH * 0.32;
    // The skin this top can touch: the torso down to just below its hem, and the arms only
    // around the sleeves. Hands and forearms hang beside the hips and must not count.
    const hemY = marks.hipY - marks.headH * (g.length === "low-hip" ? 0.48 : 0.3);
    const reach = (g.sleeve === "long" ? 0.56 : 0.22) + 0.08;
    const sim = new ClothSim(surface, {
      faces: [...clothFaces, ...trimFaces],
      ease,
      drop: 0.005,
      bendCompliance: 1e-5,
      friction: 0.85,
      thickness: (b) => (under && rest.world[b * 3 + 1] < shortsTop ? under + 0.005 : 0.004),
      touches: (b) => {
        const x = rest.world[b * 3], y = rest.world[b * 3 + 1], z = rest.world[b * 3 + 2];
        if (y < hemY - 0.12) return false;
        if (!rest.arm[b]) return true;
        return Math.hypot(Math.abs(x) - marks.shoulder.x, y - marks.shoulder.y, z - marks.shoulder.z) < reach;
      },
    });

    // One position buffer (the simulation's own array) shared by fabric and trim.
    const n = sim.source.length;
    const position = new THREE.BufferAttribute(sim.pos, 3);
    position.setUsage(THREE.DynamicDrawUsage);
    const normal = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    const srcUv = cloth.getAttribute("uv");
    const uv = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
    for (let i = 0; i < n; i++) uv.setXY(i, srcUv.getX(sim.source[i]), srcUv.getY(sim.source[i]));
    const geometry = (from: number, to: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", position);
      geo.setAttribute("normal", normal);
      geo.setAttribute("uv", uv);
      geo.setIndex(Array.from(sim.faces.subarray(from, to)));
      return geo;
    };
    const whole = geometry(0, sim.faces.length);
    const split = clothFaces.length;
    const fabric = new THREE.MeshStandardMaterial({ map: fabricFor(g), roughness: 0.92, side: THREE.DoubleSide });
    const rib = new THREE.MeshStandardMaterial({ map: ribFor(g.trim), roughness: 0.92, side: THREE.DoubleSide });
    const meshes = [new THREE.Mesh(geometry(0, split), fabric), ...(trimFaces.length ? [new THREE.Mesh(geometry(split, sim.faces.length), rib)] : [])];
    // Simulated in world space, so it hangs off the model's root rather than the skeleton.
    let root: THREE.Object3D = body;
    while (root.parent && root.parent.type !== "Scene") root = root.parent;
    for (const m of meshes) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      root.add(m);
    }
    whole.computeVertexNormals();
    live.current = { sim, position, whole };
    cloth.dispose();
    trim?.dispose();
    return () => {
      live.current = null;
      for (const m of meshes) { m.removeFromParent(); m.geometry.dispose(); }
      whole.dispose();
      for (const mat of [fabric, rib]) { mat.map?.dispose(); mat.dispose(); }
    };
    // `weights` is a dependency on purpose: any slider change re-drops the garment on the new body.
  }, [body, rest, marks, g, ease, weights, under]);

  useFrame(() => {
    const l = live.current;
    if (!l || l.sim.settled) return;
    l.sim.step();
    l.position.needsUpdate = true;
    l.whole.computeVertexNormals();
  });

  return g.neckline === "polo-collar" ? <PoloDetails g={g} body={body} rest={rest} marks={marks} ease={ease} weights={weights} draped={live} /> : null;
}

/** Placket, buttons and the chest logo, riding on the morphed chest surface (or on the draped cloth). */
function PoloDetails({ g, body, rest, marks, ease, weights, draped }: {
  g: Garment; body: THREE.SkinnedMesh; rest: Rest; marks: Landmarks; ease: number; weights: Record<string, number>;
  draped?: React.RefObject<{ sim: ClothSim } | null>;
}) {
  const neck = marks.shoulderY + marks.headH * 0.2;
  const placketH = marks.headH * 0.5;
  const anchors = React.useMemo(() => {
    const logoW = (g.logo?.widthCm ?? 9) / 100;
    return {
      placket: frontVertex(rest, 0, neck - 0.02 - placketH / 2),
      buttons: [0.3, 0.72].map((t) => frontVertex(rest, 0, neck - 0.02 - placketH * t)),
      logo: frontVertex(rest, 0.035 + logoW / 2, marks.shoulderY - marks.headH * 0.32 - 0.012),
      logoW,
    };
  }, [rest, neck, placketH, marks, g.logo?.widthCm]);
  // Recomputed with the morph weights so details stay on the cloth surface.
  const at = React.useCallback((i: number, lift: number) => {
    const p = morphedVertex(body, i);
    p.z += ease + lift;
    return p.toArray() as THREE.Vector3Tuple;
  }, [body, ease]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placed = React.useMemo(() => ({ placket: at(anchors.placket, 0.002), buttons: anchors.buttons.map((i) => at(i, 0.0045)), logo: at(anchors.logo, 0.0015) }), [at, anchors, weights]);
  const cloth = React.useMemo(() => new THREE.MeshStandardMaterial({ color: g.color, roughness: 0.9 }), [g.color]);
  React.useEffect(() => () => cloth.dispose(), [cloth]);

  // On draped cloth, each detail follows the simulated particle it was sewn to.
  const placket = React.useRef<THREE.Mesh>(null);
  const buttons = React.useRef<(THREE.Mesh | null)[]>([]);
  const logo = React.useRef<THREE.Group>(null);
  useFrame(() => {
    const sim = draped?.current?.sim;
    if (!sim) return;
    const follow = (obj: THREE.Object3D | null, bodyVertex: number, lift: number) => {
      const j = sim.particleOf[bodyVertex];
      if (!obj || j < 0) return;
      obj.position.set(sim.pos[j * 3], sim.pos[j * 3 + 1], sim.pos[j * 3 + 2] + lift);
    };
    follow(placket.current, anchors.placket, 0.002);
    anchors.buttons.forEach((b, i) => follow(buttons.current[i], b, 0.0045));
    follow(logo.current, anchors.logo, 0.0015);
  });

  return (
    <group>
      <mesh ref={placket} position={placed.placket} material={cloth} castShadow>
        <boxGeometry args={[0.026, placketH, 0.004]} />
      </mesh>
      {placed.buttons.map((pos, i) => (
        <mesh key={i} ref={(m) => { buttons.current[i] = m; }} position={pos} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.0055, 0.0055, 0.002, 20]} />
          <meshStandardMaterial color="#C9CCD6" roughness={0.4} />
        </mesh>
      ))}
      {g.logo && (
        <group ref={logo} position={placed.logo}>
          <React.Suspense fallback={null}>
            <Logo src={g.logo.src} width={anchors.logoW} position={[0, 0, 0]} />
          </React.Suspense>
        </group>
      )}
    </group>
  );
}

function Logo({ src, width, position }: { src: string; width: number; position: THREE.Vector3Tuple }) {
  const tex = useTexture(src, (t) => { t.colorSpace = THREE.SRGBColorSpace; });
  const img = tex.image as { width: number; height: number };
  return (
    <mesh position={position}>
      <planeGeometry args={[width, (width * img.height) / img.width]} />
      <meshStandardMaterial map={tex} transparent alphaTest={0.05} roughness={0.8} />
    </mesh>
  );
}

/** The exported object a mesh belongs to: "Body", "Eyes", "Mustache-walrus", … */
function partOf(mesh: THREE.Object3D) {
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
    if (/^(Body|Eyes|Eyebrows|Eyelashes|Mustache-[a-z]+|Hair-[a-z0-9]+)$/.test(o.name)) return o.name;
  }
  return mesh.name;
}
