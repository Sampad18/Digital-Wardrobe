import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { DEPTH_RATIO, circumference, type BodyMeasurements } from "./body";

/**
 * Measures a body from photos, entirely in the browser.
 *
 * MediaPipe gives joint positions and a person/background mask. Widths are read from
 * the mask at anatomical heights placed between the joints, and the height the person
 * types in turns pixels into centimetres. A side photo adds depth, which is where a
 * belly shows up.
 */

const VERSION = "1.1.1";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task";
const MAX_SIDE = 1024;

let loading: Promise<PoseLandmarker> | null = null;

export function loadDetector() {
  loading ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
    const files = await FilesetResolver.forVisionTasks(WASM);
    return PoseLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      runningMode: "IMAGE",
      numPoses: 1,
      outputSegmentationMasks: true,
    });
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

type Mark = { x: number; y: number; v: number };

interface Scan {
  w: number;
  h: number;
  marks: Mark[];
  mask: Uint8Array;
}

export class MeasureError extends Error {}

async function scan(image: HTMLImageElement): Promise<Scan> {
  const detector = await loadDetector();
  const k = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * k);
  canvas.height = Math.round(image.naturalHeight * k);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  let result = null as Scan | null;
  detector.detect(canvas, (res) => {
    const pose = res.landmarks[0];
    const m = res.segmentationMasks?.[0];
    if (!pose || !m) return;
    const f = m.getAsFloat32Array();
    const mask = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) mask[i] = f[i] > 0.5 ? 1 : 0;
    result = { w: m.width, h: m.height, mask, marks: pose.map((p) => ({ x: p.x * m.width, y: p.y * m.height, v: p.visibility ?? 1 })) };
  });
  if (!result) throw new MeasureError("No person found. Use a photo with your whole body in the frame, standing against a plain background.");
  return result;
}

/** The body span on one row that contains (or sits nearest to) x. Small gaps are bridged. */
function run(s: Scan, y: number, x: number): [number, number] | null {
  const row = Math.round(Math.min(s.h - 1, Math.max(0, y))) * s.w;
  let cx = Math.round(x);
  if (!s.mask[row + cx]) {
    const reach = Math.round(s.w * 0.06);
    let found = -1;
    for (let d = 1; d <= reach && found < 0; d++) {
      if (s.mask[row + cx - d]) found = cx - d;
      else if (s.mask[row + cx + d]) found = cx + d;
    }
    if (found < 0) return null;
    cx = found;
  }
  const gap = 3;
  let l = cx;
  let r = cx;
  for (let x2 = cx - 1, miss = 0; x2 >= 0 && miss <= gap; x2--) { if (s.mask[row + x2]) { l = x2; miss = 0; } else miss++; }
  for (let x2 = cx + 1, miss = 0; x2 < s.w && miss <= gap; x2++) { if (s.mask[row + x2]) { r = x2; miss = 0; } else miss++; }
  return [l, r];
}

type Clip = (y: number) => [number, number];

function rows(s: Scan, y0: number, y1: number, x: number, clip?: Clip) {
  const out: { y: number; l: number; r: number; w: number }[] = [];
  const step = Math.max(1, Math.round((y1 - y0) / 24));
  for (let y = Math.round(y0); y <= y1; y += step) {
    const span = run(s, y, x);
    if (!span) continue;
    const [lo, hi] = clip ? clip(y) : [-Infinity, Infinity];
    const l = Math.max(span[0], lo);
    const r = Math.min(span[1], hi);
    if (r > l) out.push({ y, l, r, w: r - l });
  }
  if (!out.length) throw new MeasureError("Couldn't trace your outline. Try a plainer background with more contrast.");
  return out;
}

const pick = (list: ReturnType<typeof rows>, by: "min" | "max" | "median") => {
  const sorted = [...list].sort((a, b) => a.w - b.w);
  return by === "min" ? sorted[0] : by === "max" ? sorted[sorted.length - 1] : sorted[Math.floor(sorted.length / 2)];
};

/**
 * Where an arm's centre line (shoulder → elbow → wrist → hand) crosses row y, or null above it.
 * The hand landmark marks the knuckles, so the line carries straight on for `reach` px to cover the fingers.
 */
function armX(marks: Mark[], ids: number[], y: number, reach: number): number | null {
  const pts = ids.map((i) => marks[i]);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if ((y - a.y) * (y - b.y) <= 0 && a.y !== b.y) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  }
  const end = pts[pts.length - 1];
  return y > end.y && y - end.y <= reach ? end.x : null;
}

/**
 * Arms often touch the torso, so the mask alone runs shoulder-to-hand. This limits each row
 * to the space between the inner edges of the arms, using an arm width measured at the elbow,
 * where the arm usually stands clear of the body.
 */
function armClip(s: Scan, torso: number): Clip {
  const M = s.marks;
  const arms = [[11, 13, 15, 19], [12, 14, 16, 20]];
  const widths = arms.map(([, el]) => {
    const span = run(s, M[el].y, M[el].x);
    const w = span ? span[1] - span[0] : Infinity;
    return w < torso * 0.4 ? w : torso * 0.17;
  });
  // Hands are wider than forearms: use the knuckle span when it is the bigger of the two.
  const knuckles = Math.max(dist(M[17], M[19]), dist(M[18], M[20]));
  const half = Math.max(Math.min(...widths), knuckles * 1.3) / 2;
  const reach = torso * 0.18;
  return (y) => {
    const xs = arms.map((ids) => armX(M, ids, y, reach)).filter((x): x is number => x !== null).sort((a, b) => a - b);
    if (xs.length < 2) return [-Infinity, Infinity];
    return [xs[0] + half, xs[1] - half];
  };
}

const mid = (a: Mark, b: Mark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
const dist = (a: Mark, b: Mark) => Math.hypot(a.x - b.x, a.y - b.y);

/** Lowest of the given landmarks that is really inside the photo, or null when they are all cropped off. */
function lowest(s: Scan, ids: number[]) {
  const seen = ids.map((i) => s.marks[i]).filter((m) => m.v > 0.5 && m.y < s.h - 2);
  return seen.length ? Math.max(...seen.map((m) => m.y)) : null;
}

/**
 * Pixels per centimetre and where the floor is. Head to toe is best; when the feet are cropped the
 * knees stand in (knee joints sit at about 28.5% of height), and when the head is cropped the
 * shoulders do (about 81%).
 */
function frame(s: Scan, shoulderY: number, torso: number, heightCm: number, feetIds: number[], kneeIds: number[], notes: string[]) {
  // Climb from the nose until a couple of rows above the head are empty; that row is the top of the head.
  const nose = s.marks[0];
  const ear = [s.marks[7], s.marks[8]].sort((a, b) => b.v - a.v)[0];
  const headX = (nose.x + ear.x) / 2;
  const half = torso * 0.22;
  const occupied = (y: number) => {
    for (let x = Math.max(0, Math.round(headX - half)); x < Math.min(s.w, headX + half); x++) if (s.mask[y * s.w + x]) return true;
    return false;
  };
  let top = Math.round(Math.min(nose.y, shoulderY));
  let empty = 0;
  while (top > 0 && empty < 3) { top--; empty = occupied(top) ? 0 : empty + 1; }
  // The head counts as in frame when at least one clear row was found above it before the image edge.
  const head = nose.v > 0.5 && empty >= 1;
  top += empty;
  const feetY = lowest(s, feetIds);
  const kneeY = lowest(s, kneeIds);
  if (head && feetY !== null) return { pxPerCm: (feetY - top) / heightCm, floor: feetY };
  if (head && kneeY !== null) {
    notes.push("Your feet are cropped, so the scale comes from your head-to-knee height. Include your feet for a closer fit.");
    const pxPerCm = (kneeY - top) / (heightCm * 0.715);
    return { pxPerCm, floor: top + pxPerCm * heightCm };
  }
  if (feetY !== null) {
    notes.push("Your head is cropped out, so the scale comes from your shoulder height. Include your head for a closer fit.");
    return { pxPerCm: (feetY - shoulderY) / (heightCm * 0.81), floor: feetY };
  }
  if (kneeY !== null) {
    // Shoulder joints at ~81% of height, knees at ~28.5%: the span between is ~52.5%.
    notes.push("Your head and feet touch the edges of the photo, so the scale comes from your shoulder-to-knee length. Step back a little for a closer fit.");
    const pxPerCm = (kneeY - shoulderY) / (heightCm * 0.525);
    return { pxPerCm, floor: kneeY + pxPerCm * heightCm * 0.285 };
  }
  throw new MeasureError("Not enough of you is in frame to set the scale. Step back so you're in frame from head to toe.");
}

export interface Line { y: number; x1: number; x2: number; label: string }
export interface Overlay { src: string; w: number; h: number; lines: Line[] }

export interface Measured {
  body: Pick<BodyMeasurements, "heightCm" | "shoulderCm" | "chestCm" | "waistCm" | "hipCm" | "inseamCm" | "armCm" | "belly">;
  notes: string[];
  front: Overlay;
  side?: Overlay;
}

const LIMITS: Partial<Record<keyof BodyMeasurements, [number, number]>> = {
  shoulderCm: [38, 58], chestCm: [80, 130], waistCm: [64, 120], hipCm: [80, 125], inseamCm: [65, 92], armCm: [50, 68],
};

export async function measure(front: { img: HTMLImageElement; src: string }, side: { img: HTMLImageElement; src: string } | null, heightCm: number): Promise<Measured> {
  const notes: string[] = [];
  const f = await scan(front.img);
  const M = f.marks;
  const sh = mid(M[11], M[12]);
  const hp = mid(M[23], M[24]);
  const torso = hp.y - sh.y;
  if (torso <= 0) throw new MeasureError("Couldn't find your shoulders and hips. Face the camera, standing upright.");
  const cx = (sh.x + hp.x) / 2;
  const { pxPerCm, floor: footY } = frame(f, sh.y, torso, heightCm, [29, 30, 31, 32, 27, 28], [25, 26], notes);
  const cm = (px: number) => Math.round((px / pxPerCm) * 10) / 10;

  const shoulder = pick(rows(f, sh.y + torso * 0.02, sh.y + torso * 0.08, cx), "max");
  const clip = armClip(f, torso);
  const chestOpen = pick(rows(f, sh.y + torso * 0.2, sh.y + torso * 0.32, cx), "median");
  const chest = pick(rows(f, sh.y + torso * 0.2, sh.y + torso * 0.32, cx, clip), "median");
  const waist = pick(rows(f, sh.y + torso * 0.6, sh.y + torso * 0.85, cx, clip), "min");
  const hips = pick(rows(f, hp.y - torso * 0.08, hp.y + torso * 0.12, hp.x, clip), "max");
  if (chestOpen.w - chest.w > torso * 0.05) notes.push("Your arms were touching your sides, so they were trimmed off the chest width. Hold them slightly away from your body for a closer reading.");
  notes.push("Loose clothing adds width. Fitted clothes give the truest measurements.");

  // Loose shorts hide the crotch, so the inseam comes from the hip joints: the crotch sits about 8% of height below them.
  const inseam = cm(footY - hp.y) - heightCm * 0.08;

  const armPx = ([[11, 13, 15], [12, 14, 16]] as const)
    .filter(([a, b, c]) => M[a].v > 0.5 && M[b].v > 0.5 && M[c].v > 0.5)
    .map(([a, b, c]) => dist(M[a], M[b]) + dist(M[b], M[c]));
  // Landmarks sit at joint centres; the tape runs from the shoulder tip, a couple of centimetres further.
  const armCm = armPx.length ? cm(armPx.reduce((x, y) => x + y, 0) / armPx.length) + 2 : 59;

  // Arms resting on the ribs hide part of the chest, so trimming them can undershoot; the chest is
  // rarely narrower than about 70% of the shoulders.
  const chestW = chestOpen.w - chest.w > torso * 0.05 ? Math.max(cm(chest.w), Math.round(cm(shoulder.w) * 0.7 * 10) / 10) : cm(chest.w);
  const waistW = cm(waist.w);
  const hipW = cm(hips.w);
  let belly = 0;
  let waistDepth = waistW * DEPTH_RATIO.waist(0);
  let sideOverlay: Overlay | undefined;

  if (side) {
    const s = await scan(side.img);
    const S = s.marks;
    const left = [11, 23, 27].reduce((a, i) => a + S[i].v, 0) >= [12, 24, 28].reduce((a, i) => a + S[i].v, 0);
    const [shI, hpI] = left ? [11, 23] : [12, 24];
    const sSh = S[shI];
    const sHp = S[hpI];
    const sTorso = sHp.y - sSh.y;
    if (sTorso <= 0) throw new MeasureError("Couldn't read the side photo. Stand side-on, upright, with your whole body in frame.");
    const sScale = frame(s, sSh.y, sTorso, heightCm, left ? [29, 31, 27] : [30, 32, 28], left ? [25] : [26], []).pxPerCm;
    const scx = (sSh.x + sHp.x) / 2;
    const chestDepth = pick(rows(s, sSh.y + sTorso * 0.25, sSh.y + sTorso * 0.4, scx), "median");
    // Below the elbow the forearm hangs in front of the hip and would read as stomach.
    const elbowY = S[left ? 13 : 14].y;
    const bellyBottom = Math.max(sSh.y + sTorso * 0.6, Math.min(sHp.y - sTorso * 0.05, elbowY + sTorso * 0.05));
    const bellyRow = pick(rows(s, sSh.y + sTorso * 0.5, bellyBottom, scx), "max");
    waistDepth = Math.round((bellyRow.w / sScale) * 10) / 10;
    belly = Math.min(1, Math.max(0, (waistDepth / waistW - 0.72) / 0.45));
    sideOverlay = {
      src: side.src, w: s.w, h: s.h,
      lines: [
        { y: chestDepth.y, x1: chestDepth.l, x2: chestDepth.r, label: `Chest depth ${Math.round(chestDepth.w / sScale)} cm` },
        { y: bellyRow.y, x1: bellyRow.l, x2: bellyRow.r, label: `Stomach depth ${Math.round(waistDepth)} cm` },
      ],
    };
  }

  const raw = {
    heightCm,
    shoulderCm: cm(shoulder.w),
    chestCm: Math.round(circumference(chestW, chestW * DEPTH_RATIO.chest)),
    waistCm: Math.round(circumference(waistW, waistDepth)),
    hipCm: Math.round(circumference(hipW, hipW * DEPTH_RATIO.hip)),
    inseamCm: Math.round(inseam),
    armCm: Math.round(armCm),
    belly: Math.round(belly * 100) / 100,
  };
  for (const [key, [lo, hi]] of Object.entries(LIMITS) as [keyof typeof raw, [number, number]][]) {
    if (raw[key] < lo || raw[key] > hi) {
      notes.push(`${key.replace("Cm", "")} measured ${raw[key]} cm, outside the usual range, so it was capped. Check the photo is straight-on.`);
      raw[key] = Math.min(hi, Math.max(lo, raw[key]));
    }
  }
  if (!side) notes.push("No side photo, so your stomach is assumed flat. Add one to capture your belly.");

  return {
    body: raw,
    notes,
    front: {
      src: front.src, w: f.w, h: f.h,
      lines: [
        { y: shoulder.y, x1: shoulder.l, x2: shoulder.r, label: `Shoulders ${raw.shoulderCm} cm` },
        { y: chest.y, x1: chest.l, x2: chest.r, label: `Chest ${chestW} cm wide` },
        { y: waist.y, x1: waist.l, x2: waist.r, label: `Waist ${waistW} cm wide` },
        { y: hips.y, x1: hips.l, x2: hips.r, label: `Hips ${hipW} cm wide` },
      ],
    },
    side: sideOverlay,
  };
}
