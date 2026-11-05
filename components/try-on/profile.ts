import { parseAppearance, type Appearance } from "@/components/try-on-3d/appearance";
import { DEFAULT_BODY, type BodyMeasurements } from "./body";

/** Everything the try-on page remembers between visits. */
export interface Profile {
  body: BodyMeasurements;
  outfit: { topId: string | null; bottomId: string | null };
  /** True once the body came from photos rather than the built-in estimate. */
  measured: boolean;
  /** Face, sex and body type for the 3D mannequin. Absent until the 3D studio saves one. */
  appearance?: Appearance;
  updatedAt?: string;
}

const RANGES: Record<Exclude<keyof BodyMeasurements, "skin">, [number, number]> = {
  heightCm: [140, 210],
  shoulderCm: [30, 70],
  chestCm: [60, 160],
  waistCm: [50, 160],
  hipCm: [60, 160],
  inseamCm: [50, 100],
  armCm: [40, 80],
  build: [0, 1],
  belly: [0, 1],
};

/** Accepts unknown JSON and returns a well-formed profile, or null if it can't be trusted. */
export function parseProfile(input: unknown): Profile | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const b = raw.body as Record<string, unknown> | undefined;
  if (!b || typeof b !== "object") return null;
  const body = { ...DEFAULT_BODY };
  for (const [key, [lo, hi]] of Object.entries(RANGES) as [keyof typeof RANGES, [number, number]][]) {
    const v = b[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) return null;
    body[key] = v;
  }
  if (typeof b.skin !== "string" || !/^#[0-9a-fA-F]{6}$/.test(b.skin)) return null;
  body.skin = b.skin;
  const o = (raw.outfit ?? {}) as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v) ? v : null);
  return {
    body,
    outfit: { topId: id(o.topId), bottomId: id(o.bottomId) },
    measured: raw.measured === true,
    appearance: raw.appearance === undefined ? undefined : parseAppearance(raw.appearance),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}
