/** Body measurements in centimetres (circumferences for chest, waist, hips). Everything else is derived. */
export interface BodyMeasurements {
  heightCm: number;
  /** Outer shoulder width, deltoid to deltoid. */
  shoulderCm: number;
  chestCm: number;
  waistCm: number;
  hipCm: number;
  inseamCm: number;
  /** Shoulder to wrist. */
  armCm: number;
  /** 0 = slim limbs, 1 = muscular limbs. */
  build: number;
  /** 0 = flat stomach, 1 = pronounced belly. Read from the side photo. */
  belly: number;
  skin: string;
}

export type Point = { x: number; y: number };
/** A cross-section of a limb. `rl`/`rr` let one side bulge more than the other. */
export type Ring = Point & { r: number; rl?: number; rr?: number };

export const MANNEQUIN = "#BDBDBB";
export const SKIN_TONES = [MANNEQUIN, "#E9C3A4", "#C99572", "#9A6650", "#7A4B38", "#553226"];

/**
 * The owner's body, measured from their front and side photos at 172 cm (2026-11-02).
 * Hips are estimated from waist and belly: the photo reading (119 cm) measured loose boxers.
 */
export const DEFAULT_BODY: BodyMeasurements = {
  heightCm: 172,
  shoulderCm: 49,
  chestCm: 94,
  waistCm: 92,
  hipCm: 99,
  inseamCm: 74,
  armCm: 51,
  build: 0.5,
  belly: 0.22,
  skin: MANNEQUIN,
};

export const VIEW_W = 360;
export const VIEW_H = 760;
/** Pixels per centimetre, fixed so taller bodies really stand taller. */
export const SCALE = 3.55;
const FLOOR = 742;
const CX = VIEW_W / 2;

/**
 * Cross-sections are treated as ellipses: front width `w`, depth `ratio * w`.
 * These convert between a tape-measure circumference and the width a camera sees.
 */
export const DEPTH_RATIO = { chest: 0.72, hip: 0.8, waist: (belly: number) => 0.72 + belly * 0.45 };

export function circumference(width: number, depth: number) {
  const a = width / 2;
  const b = depth / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

export function widthFromCircumference(c: number, ratio: number) {
  return c / circumference(1, ratio);
}

export interface Skeleton {
  cx: number;
  s: number;
  top: number;
  floor: number;
  headH: number;
  headW: number;
  chinY: number;
  neckHalf: number;
  shoulderY: number;
  shoulderHalf: number;
  chestY: number;
  chestHalf: number;
  waistY: number;
  waistHalf: number;
  hipY: number;
  hipHalf: number;
  crotchY: number;
  kneeY: number;
  ankleY: number;
  /** Side-view depths in px. */
  chestD: number;
  waistD: number;
  hipD: number;
  bellyPx: number;
  build: number;
  belly: number;
  /** Left side; mirror with `mirrorRing` for the right. Index 0 is the shoulder. */
  arm: Ring[];
  /** Left side, hip to ankle. */
  leg: Ring[];
  hand: Point & { rx: number; ry: number; angle: number };
}

const at = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function mirror<T extends Point>(p: T, cx = CX): T {
  return { ...p, x: cx * 2 - p.x };
}

/** Mirrors a limb ring; inner and outer swap because the chain now runs down the other side. */
export function mirrorRing(p: Ring, cx = CX): Ring {
  return { ...mirror(p, cx), rl: p.rr, rr: p.rl };
}

export function skeleton(m: BodyMeasurements): Skeleton {
  const s = SCALE;
  const H = m.heightCm * s;
  const top = FLOOR - H;
  const headH = H / 7.8;
  const headW = headH * 0.72;
  const chinY = top + headH;
  const neckHalf = headW * 0.33 + m.build * 3;
  const shoulderY = chinY + headH * 0.36;
  const shoulderHalf = (m.shoulderCm * s) / 2;
  const chestY = top + H * 0.27;
  const chestHalf = (widthFromCircumference(m.chestCm, DEPTH_RATIO.chest) * s) / 2;
  const waistY = top + H * 0.385;
  const waistHalf = (widthFromCircumference(m.waistCm, DEPTH_RATIO.waist(m.belly)) * s) / 2;
  const hipY = top + H * 0.49;
  const hipHalf = (widthFromCircumference(m.hipCm, DEPTH_RATIO.hip) * s) / 2;
  const crotchY = Math.min(FLOOR - m.inseamCm * s, hipY + headH * 0.55);
  const ankleY = FLOOR - H * 0.04;
  const kneeY = ankleY - (ankleY - crotchY) * 0.52;

  const upperR = (4 + m.build * 1.5) * s;
  // The arm starts inside the deltoid, which belongs to the torso outline, so the shoulder reads as one form.
  const joint = { x: CX - (shoulderHalf - upperR * 1.15), y: shoulderY + headH * 0.32 };
  const upper = m.armCm * 0.5 * s;
  const fore = m.armCm * 0.5 * s;
  const a1 = (8 * Math.PI) / 180;
  const a2 = (13 * Math.PI) / 180;
  const elbow = { x: joint.x - Math.sin(a1) * upper, y: joint.y + Math.cos(a1) * upper };
  const wrist = { x: elbow.x - Math.sin(a2) * fore, y: elbow.y + Math.cos(a2) * fore };
  const foreR = (3.4 + m.build * 0.9) * s;
  const arm: Ring[] = [
    { ...joint, r: upperR * 1.08, rl: upperR * 1.2, rr: upperR * 0.95 },
    { ...at(joint, elbow, 0.5), r: upperR, rl: upperR * 0.94, rr: upperR * 1.04 },
    { ...elbow, r: 3.3 * s },
    { ...at(elbow, wrist, 0.28), r: foreR, rl: foreR * 1.12, rr: foreR * 0.95 },
    { ...wrist, r: 2.4 * s },
  ];
  const handLen = m.armCm * 0.31 * s;
  const hand = { x: wrist.x - Math.sin(a2) * handLen * 0.42, y: wrist.y + Math.cos(a2) * handLen * 0.42, rx: 2.5 * s, ry: handLen / 2, angle: 13 };

  const hipJoint = { x: CX - hipHalf * 0.5, y: hipY };
  const knee = { x: CX - hipHalf * 0.45, y: kneeY };
  const ankle = { x: CX - hipHalf * 0.42, y: ankleY };
  const thighR = hipHalf * 0.55 * (0.94 + m.build * 0.1);
  const kneeR = (4.9 + m.build * 0.5) * s;
  const calfR = (5.2 + m.build * 1.8) * s;
  const ankleR = 2.9 * s;
  const leg: Ring[] = [
    { ...hipJoint, r: hipHalf * 0.5, rl: hipHalf * 0.52, rr: hipHalf * 0.48 },
    { ...at(hipJoint, knee, 0.22), r: thighR, rl: thighR * 1.04, rr: thighR * 0.9 },
    { ...at(hipJoint, knee, 0.55), r: thighR * 0.86, rl: thighR * 0.88, rr: thighR * 0.8 },
    { ...at(hipJoint, knee, 0.86), r: kneeR * 1.15, rl: kneeR * 1.05, rr: kneeR * 1.3 },
    { ...knee, r: kneeR },
    { ...at(knee, ankle, 0.24), r: calfR, rl: calfR * 0.94, rr: calfR * 1.1 },
    { ...at(knee, ankle, 0.5), r: calfR * 0.78 },
    { ...at(knee, ankle, 0.8), r: ankleR * 1.25 },
    { ...ankle, r: ankleR },
  ];

  return {
    cx: CX, s, top, floor: FLOOR, headH, headW, chinY, neckHalf, shoulderY, shoulderHalf, chestY, chestHalf, waistY, waistHalf, hipY, hipHalf, crotchY, kneeY, ankleY,
    chestD: chestHalf * 2 * DEPTH_RATIO.chest,
    waistD: waistHalf * 2 * 0.72,
    hipD: hipHalf * 2 * DEPTH_RATIO.hip,
    bellyPx: waistHalf * 2 * m.belly * 0.45,
    build: m.build,
    belly: m.belly,
    arm, leg, hand,
  };
}

const f = (n: number) => n.toFixed(1);

/** Catmull-Rom through the points as cubic Béziers; the path continues from the first point. */
export function smooth(points: Point[]): string {
  let d = "";
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** A closed outline around a chain of rings, with rounded ends. Used for limbs and sleeves. */
export function tube(rings: Ring[], capStart = true): string {
  const normals = rings.map((p, i) => {
    const a = rings[Math.max(0, i - 1)];
    const b = rings[Math.min(rings.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  });
  const left = rings.map((p, i) => ({ x: p.x + normals[i].x * (p.rl ?? p.r), y: p.y + normals[i].y * (p.rl ?? p.r) }));
  const right = rings.map((p, i) => ({ x: p.x - normals[i].x * (p.rr ?? p.r), y: p.y - normals[i].y * (p.rr ?? p.r) })).reverse();
  const end = rings[rings.length - 1];
  const start = rings[0];
  const endR = ((end.rl ?? end.r) + (end.rr ?? end.r)) / 2;
  const startR = ((start.rl ?? start.r) + (start.rr ?? start.r)) / 2;
  return `M ${f(left[0].x)} ${f(left[0].y)}${smooth(left)} A ${f(endR)} ${f(endR)} 0 0 0 ${f(right[0].x)} ${f(right[0].y)}${smooth(right)}${capStart ? ` A ${f(startR)} ${f(startR)} 0 0 0 ${f(left[0].x)} ${f(left[0].y)}` : ""} Z`;
}

/** Closed path from the left half of a symmetric outline, listed top to bottom. */
export function symmetric(leftSide: Point[], cx = CX): string {
  const right = leftSide.map((p) => mirror(p, cx)).reverse();
  const all = [...leftSide, ...right];
  return `M ${f(all[0].x)} ${f(all[0].y)}${smooth(all)} Z`;
}

/** Closed smooth path through points in order. */
export function closed(points: Point[]): string {
  return `M ${f(points[0].x)} ${f(points[0].y)}${smooth([...points, points[0]])} Z`;
}

/** Point along a ring chain at fraction t of its length, with the interpolated radius. */
export function along(rings: Ring[], t: number): Ring {
  const lens = rings.slice(1).map((p, i) => Math.hypot(p.x - rings[i].x, p.y - rings[i].y));
  let left = lens.reduce((a, b) => a + b, 0) * Math.min(1, Math.max(0, t));
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) {
      const k = lens[i] ? Math.min(1, left / lens[i]) : 0;
      return { ...at(rings[i], rings[i + 1], k), r: rings[i].r + (rings[i + 1].r - rings[i].r) * k };
    }
    left -= lens[i];
  }
  return rings[rings.length - 1];
}

/** Rings from the start of a chain up to fraction t, with symmetric radii (for clothing). */
export function upTo(rings: Ring[], t: number): Ring[] {
  const lens = rings.slice(1).map((p, i) => Math.hypot(p.x - rings[i].x, p.y - rings[i].y));
  const total = lens.reduce((a, b) => a + b, 0);
  const out: Ring[] = [{ x: rings[0].x, y: rings[0].y, r: rings[0].r }];
  let acc = 0;
  for (let i = 0; i < lens.length; i++) {
    if (acc + lens[i] >= total * t) break;
    acc += lens[i];
    out.push({ x: rings[i + 1].x, y: rings[i + 1].y, r: rings[i + 1].r });
  }
  out.push(along(rings, t));
  return out;
}

export function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Front torso silhouette, left half listed from the neck down to the crotch. */
export function torsoPoints(k: Skeleton): Point[] {
  const { cx, headH, build, belly } = k;
  const trap = headH * (0.06 + build * 0.05);
  const handle = 1 + belly * 0.07;
  return [
    // The neck starts well inside the head so its top edge never shows below the jaw.
    { x: cx - k.neckHalf * 0.4, y: k.chinY - headH * 0.4 },
    { x: cx - k.neckHalf * 0.92, y: k.chinY - headH * 0.25 },
    { x: cx - k.neckHalf * 1.1, y: k.shoulderY - headH * 0.24 },
    { x: cx - k.neckHalf - (k.shoulderHalf - k.neckHalf) * 0.42, y: k.shoulderY - headH * 0.12 - trap * 0.2 },
    { x: cx - k.shoulderHalf * 0.8, y: k.shoulderY - headH * 0.04 },
    { x: cx - k.shoulderHalf * 0.97, y: k.shoulderY + headH * 0.12 },
    { x: cx - k.shoulderHalf, y: k.shoulderY + headH * 0.32 },
    { x: cx - k.shoulderHalf * 0.94, y: k.shoulderY + headH * 0.55 },
    { x: cx - k.chestHalf * 1.0, y: k.chestY + headH * 0.05 },
    { x: cx - k.chestHalf * (0.97 - build * 0.02), y: k.chestY + headH * 0.3 },
    { x: cx - k.waistHalf * handle, y: k.waistY + belly * headH * 0.12 },
    { x: cx - k.hipHalf * 0.94, y: k.hipY - headH * 0.22 },
    { x: cx - k.hipHalf, y: k.hipY },
    { x: cx - k.hipHalf * 0.9, y: k.crotchY - headH * 0.12 },
    { x: cx - 1, y: k.crotchY },
  ];
}

export function torsoPath(k: Skeleton): string {
  return symmetric(torsoPoints(k), k.cx);
}
