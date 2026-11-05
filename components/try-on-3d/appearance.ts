import type { BodyMeasurements } from "@/components/try-on/body";
import meta from "./mannequin-meta.json";

/**
 * Everything about the mannequin that isn't a tape-measure number: sex, body
 * type and the face. Body measurements (shoulders, chest, waist, legs, belly)
 * stay in `BodyMeasurements`, so photo measuring keeps setting them.
 *
 * Sliders run -1..1 with 0 as the neutral MPFB face. Each maps onto a pair of
 * morph targets in `public/models/mannequin.glb` (built by tools/mpfb).
 */
export interface Appearance {
  /** 0 = male, 1 = female; in-between blends. */
  sex: number;
  /** -1 thin … 1 heavy. */
  weight: number;
  /** -1 soft … 1 muscular. */
  muscle: number;
  face: { shape: FaceShape; width: number; fullness: number };
  nose: { width: number; length: number; hump: number; tip: number; nostrils: number; size: number };
  eyes: { size: number; distance: number; color: EyeColor };
  mouth: { width: number; height: number; upperLip: number; lowerLip: number; corners: number };
  chin: { prominence: number; width: number; height: number; jaw: number; pointed: number };
  mustache: Mustache;
  hair: HairStyle;
  /** Tints the hair, eyebrows and mustache together. */
  hairColor: HairColor;
}

export const FACE_SHAPES = ["natural", "oval", "round", "square", "heart", "triangular", "diamond", "long"] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];

export const EYE_COLORS = {
  brown: "#5A3A22",
  "dark brown": "#2E1D12",
  hazel: "#7A6235",
  green: "#4E7046",
  blue: "#4C77A8",
  grey: "#7D8892",
} as const;
export type EyeColor = keyof typeof EYE_COLORS;

export const MUSTACHES = ["none", "chevron", "pencil", "handlebar", "walrus", "horseshoe"] as const;
export type Mustache = (typeof MUSTACHES)[number];

/** MakeHuman's CC0 system hairstyles, keyed by asset name (meshes "Hair-<key>" in the model). */
export const HAIR_STYLES = {
  none: "None",
  short04: "Crew cut",
  short03: "Side part",
  short02: "Short tousled",
  short01: "Short spiky",
  afro01: "Afro",
  bob01: "Bob",
  bob02: "Straight bob",
  long01: "Long",
  ponytail01: "Ponytail",
  braid01: "Braid",
} as const;
export type HairStyle = keyof typeof HAIR_STYLES;

export const HAIR_COLORS = {
  black: "#1C1714",
  "dark brown": "#3B2A20",
  brown: "#5E4231",
  "light brown": "#8C6B4B",
  blonde: "#C8A66B",
  auburn: "#7C3A22",
  grey: "#9C9A97",
} as const;
export type HairColor = keyof typeof HAIR_COLORS;

/** Thin → muscular → fat, as weight/muscle pairs on the same sliders the user can fine-tune. */
export const BODY_TYPES = [
  { name: "Thin", weight: -1, muscle: -0.5 },
  { name: "Slim", weight: -0.55, muscle: -0.1 },
  { name: "Average", weight: 0, muscle: 0 },
  { name: "Athletic", weight: -0.25, muscle: 0.55 },
  { name: "Muscular", weight: 0.1, muscle: 1 },
  { name: "Heavy", weight: 0.6, muscle: 0.15 },
  { name: "Fat", weight: 1, muscle: -0.35 },
] as const;

/** Named mouths built from the mouth sliders. */
export const MOUTH_TYPES = {
  natural: { width: 0, height: 0, upperLip: 0, lowerLip: 0, corners: 0 },
  thin: { width: 0.1, height: -0.4, upperLip: -0.8, lowerLip: -0.7, corners: 0 },
  full: { width: 0, height: 0.3, upperLip: 0.8, lowerLip: 0.9, corners: 0 },
  wide: { width: 0.8, height: 0, upperLip: 0.1, lowerLip: 0.1, corners: 0.1 },
  small: { width: -0.7, height: -0.2, upperLip: 0.2, lowerLip: 0.2, corners: 0 },
  smiling: { width: 0.2, height: 0, upperLip: 0, lowerLip: 0, corners: 0.8 },
} as const;
export type MouthType = keyof typeof MOUTH_TYPES;

export const DEFAULT_APPEARANCE: Appearance = {
  sex: 0,
  weight: 0,
  muscle: 0,
  face: { shape: "natural", width: 0, fullness: 0 },
  nose: { width: 0, length: 0, hump: 0, tip: 0, nostrils: 0, size: 0 },
  eyes: { size: 0, distance: 0, color: "brown" },
  mouth: { ...MOUTH_TYPES.natural },
  chin: { prominence: 0, width: 0, height: 0, jaw: 0, pointed: 0 },
  mustache: "none",
  hair: "short02",
  hairColor: "dark brown",
};

/** Sets a bipolar slider onto its incr/decr morph pair. */
function bipolar(out: Record<string, number>, prefix: string, v: number, [up, down] = ["incr", "decr"]) {
  out[`${prefix}-${up}`] = Math.max(0, v);
  out[`${prefix}-${down}`] = Math.max(0, -v);
}

type Measure = "heightCm" | "shoulderCm" | "chestCm" | "waistCm" | "hipCm" | "inseamCm";
const MORPHS = meta.morphs as Record<string, Record<Measure, number>>;

/**
 * Change in one measurement predicted from the morphs already set. Weight and
 * muscle are left out on purpose: body type is a change on top of your
 * measurements, so "Thin" really is thinner than you, not re-fitted back.
 */
function predicted(w: Record<string, number>, m: Measure) {
  let sum = 0;
  for (const [name, weight] of Object.entries(w)) {
    if (name.startsWith("weight-") || name.startsWith("muscle-")) continue;
    sum += (MORPHS[name]?.[m] ?? 0) * weight;
  }
  return sum;
}

/** Solves one measurement onto its incr/decr pair, given everything else already set. */
function fit(w: Record<string, number>, m: Measure, prefix: string, target: number, max = 1.5) {
  const residual = target - meta.base[m] - predicted(w, m);
  const up = MORPHS[`${prefix}-incr`]?.[m] ?? 0;
  const down = MORPHS[`${prefix}-decr`]?.[m] ?? 0;
  const k = residual >= 0 ? (up > 0 ? residual / up : 0) : down < 0 ? residual / down : 0;
  bipolar(w, prefix, residual >= 0 ? Math.min(max, k) : -Math.min(max, k));
}

/**
 * Morph weights for the mannequin. Appearance sliders map straight across;
 * measurements are solved in order (legs, then height, then the torso), each
 * accounting for what sex, body type and earlier fits already changed.
 */
export function morphWeights(a: Appearance, body: BodyMeasurements): Record<string, number> {
  const w: Record<string, number> = {};
  w.female = a.sex;
  bipolar(w, "weight", a.weight, ["max", "min"]);
  bipolar(w, "muscle", a.muscle, ["max", "min"]);

  for (const shape of FACE_SHAPES) if (shape !== "natural") w[`face-${shape}`] = a.face.shape === shape ? 1 : 0;
  bipolar(w, "face-width", a.face.width);
  bipolar(w, "face-fat", a.face.fullness);

  bipolar(w, "nose-width", a.nose.width);
  bipolar(w, "nose-length", a.nose.length);
  bipolar(w, "nose-hump", a.nose.hump);
  bipolar(w, "nose-tip", a.nose.tip, ["up", "down"]);
  bipolar(w, "nose-nostrils", a.nose.nostrils);
  bipolar(w, "nose-size", a.nose.size);

  bipolar(w, "eye-size", a.eyes.size);
  bipolar(w, "eye-distance", a.eyes.distance);

  bipolar(w, "mouth-width", a.mouth.width);
  bipolar(w, "mouth-height", a.mouth.height);
  bipolar(w, "lip-upper", a.mouth.upperLip);
  bipolar(w, "lip-lower", a.mouth.lowerLip);
  bipolar(w, "mouth-corners", a.mouth.corners, ["up", "down"]);

  bipolar(w, "chin-prominent", a.chin.prominence);
  bipolar(w, "chin-width", a.chin.width);
  bipolar(w, "chin-height", a.chin.height);
  bipolar(w, "jaw-width", a.chin.jaw);
  w["chin-pointed"] = Math.max(0, a.chin.pointed);

  // Belly first: it's a shape choice, and it widens the waist the fit below solves for.
  w["belly-incr"] = body.belly * 1.2;
  fit(w, "inseamCm", "legs", body.inseamCm);
  const heightResidual = body.heightCm - meta.base.heightCm - predicted(w, "heightCm");
  bipolar(w, "height", heightResidual / (heightResidual >= 0 ? MORPHS["height-max"].heightCm : -MORPHS["height-min"].heightCm), ["max", "min"]);
  fit(w, "shoulderCm", "shoulders", body.shoulderCm);
  fit(w, "chestCm", "chest", body.chestCm);
  fit(w, "hipCm", "hips", body.hipCm);
  fit(w, "waistCm", "waist", body.waistCm);
  return w;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);

/** Accepts unknown JSON and returns a complete appearance, filling anything missing with defaults. */
export function parseAppearance(input: unknown): Appearance {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, Record<string, unknown> | unknown>;
  const group = <K extends keyof Appearance>(key: K) => (raw[key] && typeof raw[key] === "object" ? raw[key] : {}) as Record<string, unknown>;
  const sliders = <G extends Record<string, unknown>>(key: keyof Appearance, defaults: G) =>
    Object.fromEntries(Object.entries(defaults).map(([k, d]) => [k, typeof d === "number" ? clamp(group(key)[k], -1, 1, d) : d])) as G;
  const d = DEFAULT_APPEARANCE;
  return {
    sex: clamp(raw.sex, 0, 1, d.sex),
    weight: clamp(raw.weight, -1, 1, d.weight),
    muscle: clamp(raw.muscle, -1, 1, d.muscle),
    face: { ...sliders("face", d.face), shape: pick(group("face").shape, FACE_SHAPES, d.face.shape) },
    nose: sliders("nose", d.nose),
    eyes: { ...sliders("eyes", d.eyes), color: pick(group("eyes").color, Object.keys(EYE_COLORS) as EyeColor[], d.eyes.color) },
    mouth: sliders("mouth", d.mouth),
    chin: sliders("chin", d.chin),
    mustache: pick(raw.mustache, MUSTACHES, d.mustache),
    hair: pick(raw.hair, Object.keys(HAIR_STYLES) as HairStyle[], d.hair),
    hairColor: pick(raw.hairColor, Object.keys(HAIR_COLORS) as HairColor[], d.hairColor),
  };
}
