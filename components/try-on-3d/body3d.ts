import * as THREE from "three";
import { DEPTH_RATIO, widthFromCircumference, type BodyMeasurements } from "@/components/try-on/body";

/**
 * The 3D body as data, in metres with y up and +z facing forward.
 * Proportions follow `skeleton()` in the 2D studio so both views agree.
 * Garments are built from these same sections and rings plus ease, which is
 * what makes one garment record fit any set of measurements.
 */

/** A torso cross-section: half-width, and front/back half-depths (the belly lives in `bf`). */
export interface Section {
  y: number;
  a: number;
  bf: number;
  bb: number;
}

/** A limb cross-section centred on a point of the limb's axis. */
export interface LimbRing {
  p: THREE.Vector3;
  r: number;
}

export interface Body3D {
  H: number;
  headH: number;
  chinY: number;
  shoulderY: number;
  chestY: number;
  waistY: number;
  hipY: number;
  crotchY: number;
  kneeY: number;
  ankleY: number;
  neckR: number;
  chestHalf: number;
  /** Key torso sections, bottom to top. `torsoSamples` smooths them. */
  torso: Section[];
  /** Index of the neck-base section (crew necklines end here). */
  neckBase: number;
  /** Index of the trapezius section (boat necklines end here). */
  trapezius: number;
  /** Left arm (+x), deltoid to wrist. Mirror with `mirrorRings` for the right. */
  arm: LimbRing[];
  /** Left leg, hip to ankle. */
  leg: LimbRing[];
  handLen: number;
}

/** Superellipse exponent: a little squarer than an ellipse reads as a torso, not a tube. */
const SQUARE = 2.5;

export function body3d(m: BodyMeasurements): Body3D {
  const H = m.heightCm / 100;
  const headH = H / 7.8;
  const chinY = H - headH;
  const shoulderY = chinY - headH * 0.36;
  const chestY = H * 0.73;
  const waistY = H * 0.615;
  const hipY = H * 0.51;
  const crotchY = Math.max(m.inseamCm / 100, hipY - headH * 0.55);
  const ankleY = H * 0.04;
  const kneeY = ankleY + (crotchY - ankleY) * 0.48;

  const shoulderHalf = m.shoulderCm / 200;
  const neckR = headH * 0.72 * 0.33 + m.build * 0.0085;
  const upperR = (4 + m.build * 1.5) / 100;

  const chestHalf = widthFromCircumference(m.chestCm, DEPTH_RATIO.chest) / 200;
  const chestD = chestHalf * DEPTH_RATIO.chest;
  const waistRatio = DEPTH_RATIO.waist(m.belly);
  const waistHalf = widthFromCircumference(m.waistCm, waistRatio) / 200;
  const waistBack = waistHalf * 0.66;
  const waistFront = waistHalf * waistRatio * 2 - waistBack;
  const hipHalf = widthFromCircumference(m.hipCm, DEPTH_RATIO.hip) / 200;
  const hipD = hipHalf * DEPTH_RATIO.hip;

  const torso: Section[] = [
    { y: crotchY - 0.045, a: 0.004, bf: 0.004, bb: 0.004 },
    { y: crotchY - 0.03, a: hipHalf * 0.45, bf: hipD * 0.45, bb: hipD * 0.55 },
    { y: crotchY - 0.005, a: hipHalf * 0.78, bf: hipD * 0.72, bb: hipD * 0.95 },
    { y: hipY, a: hipHalf, bf: hipD * 0.85, bb: hipD * 1.15 },
    { y: (hipY + waistY) / 2, a: (hipHalf + waistHalf) / 2 * 0.98, bf: (hipD * 0.85 + waistFront) / 2, bb: (hipD + waistBack) / 2 },
    { y: waistY, a: waistHalf * (1 + m.belly * 0.05), bf: waistFront, bb: waistBack },
    { y: (waistY + chestY) / 2, a: (waistHalf + chestHalf) / 2, bf: (waistFront + chestD * 1.02) / 2, bb: (waistBack + chestD * 0.95) / 2 },
    { y: chestY, a: chestHalf, bf: chestD * 1.04, bb: chestD * 0.96 },
    { y: shoulderY - headH * 0.3, a: Math.max(chestHalf, shoulderHalf - upperR * 0.95), bf: chestD * 0.92, bb: chestD * 0.98 },
    { y: shoulderY - headH * 0.04, a: shoulderHalf - upperR * 1.05, bf: chestD * 0.62, bb: chestD * 0.78 },
    { y: shoulderY + headH * 0.1, a: neckR + (shoulderHalf - neckR) * 0.42, bf: neckR * 1.35, bb: neckR * 1.7 },
    { y: shoulderY + headH * 0.22, a: neckR * 1.08, bf: neckR * 1.02, bb: neckR * 1.08 },
    { y: chinY + headH * 0.04, a: neckR, bf: neckR * 0.9, bb: neckR },
    { y: chinY + headH * 0.3, a: neckR * 0.9, bf: neckR * 0.8, bb: neckR * 0.9 },
  ];

  // Arm hangs slightly out from the body, forearm angled a little more, palms forward.
  const joint = new THREE.Vector3(shoulderHalf - upperR * 1.15, shoulderY - headH * 0.22, -0.005);
  const upper = (m.armCm * 0.5) / 100;
  const fore = (m.armCm * 0.5) / 100;
  const a1 = THREE.MathUtils.degToRad(8);
  const a2 = THREE.MathUtils.degToRad(13);
  const elbow = joint.clone().add(new THREE.Vector3(Math.sin(a1) * upper, -Math.cos(a1) * upper, -0.01));
  const wrist = elbow.clone().add(new THREE.Vector3(Math.sin(a2) * fore, -Math.cos(a2) * fore, 0.03));
  const foreR = (3.4 + m.build * 0.9) / 100;
  const arm: LimbRing[] = [
    // Starts low inside the shoulder so the deltoid never rises above the torso's shoulder line.
    { p: joint.clone().add(new THREE.Vector3(-0.02, 0.028, 0)), r: upperR * 0.8 },
    { p: joint, r: upperR * 1.12 },
    { p: joint.clone().lerp(elbow, 0.5), r: upperR },
    { p: elbow, r: 0.034 },
    { p: elbow.clone().lerp(wrist, 0.28), r: foreR },
    { p: wrist, r: 0.025 },
  ];

  const hipJoint = new THREE.Vector3(hipHalf * 0.5, hipY - 0.01, 0);
  const knee = new THREE.Vector3(hipHalf * 0.45, kneeY, 0.008);
  const ankle = new THREE.Vector3(hipHalf * 0.42, ankleY, -0.01);
  const thighR = hipHalf * 0.55 * (0.94 + m.build * 0.1);
  const kneeR = (4.9 + m.build * 0.5) / 100;
  const calfR = (5.2 + m.build * 1.8) / 100;
  const leg: LimbRing[] = [
    { p: hipJoint.clone().add(new THREE.Vector3(-hipHalf * 0.05, 0.04, 0)), r: hipHalf * 0.36 },
    { p: hipJoint, r: hipHalf * 0.5 },
    { p: hipJoint.clone().lerp(knee, 0.22), r: thighR },
    { p: hipJoint.clone().lerp(knee, 0.55), r: thighR * 0.84 },
    { p: hipJoint.clone().lerp(knee, 0.86), r: kneeR * 1.12 },
    { p: knee, r: kneeR },
    { p: knee.clone().lerp(ankle, 0.24).add(new THREE.Vector3(0, 0, -0.012)), r: calfR },
    { p: knee.clone().lerp(ankle, 0.5), r: calfR * 0.78 },
    { p: knee.clone().lerp(ankle, 0.8), r: 0.036 },
    { p: ankle, r: 0.029 },
  ];

  return {
    H, headH, chinY, shoulderY, chestY, waistY, hipY, crotchY, kneeY, ankleY, neckR, chestHalf,
    torso, neckBase: 11, trapezius: 10, arm, leg,
    handLen: (m.armCm * 0.31) / 100,
  };
}

export function mirrorRings(rings: LimbRing[]): LimbRing[] {
  return rings.map(({ p, r }) => ({ p: new THREE.Vector3(-p.x, p.y, p.z), r }));
}

// ---------------------------------------------------------------- sampling --

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** Catmull-Rom through the key sections, `per` samples per span. */
export function smoothSections(keys: Section[], per = 8): Section[] {
  const out: Section[] = [];
  const fields = ["y", "a", "bf", "bb"] as const;
  for (let i = 0; i < keys.length - 1; i++) {
    const p0 = keys[i - 1] ?? keys[i];
    const p1 = keys[i];
    const p2 = keys[i + 1];
    const p3 = keys[i + 2] ?? p2;
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const s = {} as Section;
      for (const f of fields) s[f] = Math.max(f === "y" ? -Infinity : 0.002, cr(p0[f], p1[f], p2[f], p3[f], t));
      out.push(s);
    }
  }
  out.push({ ...keys[keys.length - 1] });
  return out;
}

/** Smoothed sections between two heights, with exact sections at both cut lines. */
export function sliceSections(samples: Section[], y0: number, y1: number): Section[] {
  const at = (y: number): Section => {
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      if ((a.y <= y && b.y >= y) || (a.y >= y && b.y <= y)) {
        const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
        return { y, a: a.a + (b.a - a.a) * t, bf: a.bf + (b.bf - a.bf) * t, bb: a.bb + (b.bb - a.bb) * t };
      }
    }
    return { ...samples[y < samples[0].y ? 0 : samples.length - 1], y };
  };
  const inner = samples.filter((s) => s.y > y0 + 1e-4 && s.y < y1 - 1e-4);
  return [at(y0), ...inner, at(y1)];
}

export function grow(sections: Section[], d: number): Section[] {
  return sections.map((s) => ({ y: s.y, a: s.a + d, bf: s.bf + d, bb: s.bb + d }));
}

/** Point on a section's outline. θ = 0 faces front, θ = π/2 faces +x. */
export function sectionPoint(s: Section, theta: number, out = new THREE.Vector3()) {
  const sn = Math.sin(theta);
  const cs = Math.cos(theta);
  const e = 2 / SQUARE;
  const x = s.a * Math.sign(sn) * Math.abs(sn) ** e;
  const z = (cs >= 0 ? s.bf : s.bb) * Math.sign(cs) * Math.abs(cs) ** e;
  return out.set(x, s.y, z);
}

/** Front surface depth of a section at a given x, and the surface slope there. */
export function frontAt(s: Section, x: number) {
  const z = (xx: number) => {
    const sn = Math.min(1, Math.abs(xx) / s.a) ** (SQUARE / 2);
    return s.bf * Math.sqrt(Math.max(0, 1 - sn * sn)) ** (2 / SQUARE);
  };
  const h = 0.004;
  return { z: z(x), slope: (z(x + h) - z(x - h)) / (2 * h) };
}

// -------------------------------------------------------------- geometry ----

const SEGS = 72;

/**
 * Stitches rows of ring points into an indexed surface. Rows run along the
 * axis, columns around it; the extra closing column carries the texture seam,
 * which every builder puts at the back.
 */
function surface(rows: THREE.Vector3[][], us: number[][], vs: number[]) {
  const cols = rows[0].length;
  const pos = new Float32Array(rows.length * cols * 3);
  const uv = new Float32Array(rows.length * cols * 2);
  rows.forEach((row, i) =>
    row.forEach((p, j) => {
      const k = i * cols + j;
      pos.set([p.x, p.y, p.z], k * 3);
      uv.set([us[i][j], vs[i]], k * 2);
    }),
  );
  const index: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  // The seam column is duplicated for UVs; average its normals so no crease shows.
  const n = geo.getAttribute("normal") as THREE.BufferAttribute;
  for (let i = 0; i < rows.length; i++) {
    const a = i * cols;
    const b = a + cols - 1;
    const v = new THREE.Vector3(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
  return geo;
}

/** Surface through torso sections. UVs are in metres, so textures tile at true size. */
export function loftGeometry(sections: Section[]) {
  const rows: THREE.Vector3[][] = [];
  const us: number[][] = [];
  const vs: number[] = [];
  let v = 0;
  sections.forEach((s, i) => {
    const row: THREE.Vector3[] = [];
    const u: number[] = [];
    let arc = 0;
    let prev: THREE.Vector3 | null = null;
    for (let j = 0; j <= SEGS; j++) {
      const p = sectionPoint(s, Math.PI + (j / SEGS) * Math.PI * 2);
      if (prev) arc += p.distanceTo(prev);
      prev = p;
      row.push(p);
      u.push(arc);
    }
    if (i > 0) {
      const a = sections[i - 1];
      v += Math.hypot(s.y - a.y, s.bf - a.bf);
    }
    rows.push(row);
    us.push(u);
    vs.push(v);
  });
  return surface(rows, us, vs);
}

function curveOf(rings: LimbRing[]) {
  return new THREE.CatmullRomCurve3(rings.map((r) => r.p), false, "centripetal");
}

function radiusAt(rings: LimbRing[], t: number) {
  const u = t * (rings.length - 1);
  const i = Math.min(rings.length - 2, Math.floor(u));
  const r = (k: number) => rings[Math.max(0, Math.min(rings.length - 1, k))].r;
  return cr(r(i - 1), r(i), r(i + 1), r(i + 2), u - i);
}

/** Curve parameter where a limb's axis first drops to height `y`. */
export function tAtHeight(rings: LimbRing[], y: number) {
  const curve = curveOf(rings);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (curve.getPoint(mid).y > y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function pointAt(rings: LimbRing[], t: number) {
  const curve = curveOf(rings);
  return { p: curve.getPoint(t), tangent: curve.getTangent(t), r: radiusAt(rings, t) };
}

interface TubeOptions {
  t0?: number;
  t1?: number;
  /** Added to the limb radius; `k` runs 0→1 along the slice, for flares. */
  extra?: (k: number) => number;
  capStart?: boolean;
  capEnd?: boolean;
}

/** A tube around a limb axis: the skin itself, or a sleeve / trouser leg with `extra` ease. */
export function tubeGeometry(rings: LimbRing[], { t0 = 0, t1 = 1, extra = () => 0, capStart = false, capEnd = false }: TubeOptions = {}) {
  const curve = curveOf(rings);
  const front = new THREE.Vector3(0, 0, 1);
  const samples = Math.max(8, Math.round((t1 - t0) * 70));
  type Row = { p: THREE.Vector3; t: THREE.Vector3; r: number };
  const axis: Row[] = [];
  for (let k = 0; k <= samples; k++) {
    const t = t0 + ((t1 - t0) * k) / samples;
    axis.push({ p: curve.getPoint(t), t: curve.getTangent(t), r: radiusAt(rings, t) + extra(k / samples) });
  }
  const cap = (end: Row, dir: 1 | -1) =>
    [0.45, 0.75, 0.92, 1].map((f) => ({ p: end.p.clone().addScaledVector(end.t, dir * end.r * f), t: end.t, r: end.r * Math.sqrt(Math.max(0, 1 - f * f)) + 0.0005 }));
  const all = [
    ...(capStart ? cap(axis[0], -1).reverse() : []),
    ...axis,
    ...(capEnd ? cap(axis[axis.length - 1], 1) : []),
  ];

  const rows: THREE.Vector3[][] = [];
  const us: number[][] = [];
  const vs: number[] = [];
  let v = 0;
  all.forEach((row, i) => {
    const n = front.clone().addScaledVector(row.t, -front.dot(row.t)).normalize();
    const b = new THREE.Vector3().crossVectors(row.t, n);
    const pts: THREE.Vector3[] = [];
    const u: number[] = [];
    for (let j = 0; j <= SEGS; j++) {
      const phi = Math.PI + (j / SEGS) * Math.PI * 2;
      pts.push(row.p.clone().addScaledVector(n, Math.cos(phi) * row.r).addScaledVector(b, Math.sin(phi) * row.r));
      u.push((j / SEGS) * Math.PI * 2 * row.r);
    }
    if (i > 0) v += row.p.distanceTo(all[i - 1].p);
    rows.push(pts);
    us.push(u);
    vs.push(v);
  });
  return surface(rows, us, vs);
}
