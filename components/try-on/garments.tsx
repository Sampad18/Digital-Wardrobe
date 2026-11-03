import * as React from "react";
import { along, mirror, shade, smooth, symmetric, tube, upTo, type Point, type Ring, type Skeleton } from "./body";

/**
 * A garment as data. The renderer turns a record into shapes hung on a body's
 * skeleton, so one record fits any set of measurements.
 */
export interface Garment {
  id: string;
  name: string;
  category: "top" | "bottom";
  type: "polo" | "tee" | "long-sleeve" | "shorts";
  fit: "slim" | "regular" | "relaxed";
  neckline?: "polo-collar" | "crew" | "boat";
  sleeve?: "short" | "long";
  length: "hip" | "low-hip" | "above-knee";
  color: string;
  trim: string;
  pattern?: { kind: "stripe"; color: string; widthCm: number; gapCm: number } | { kind: "print"; ink: string };
  /** Cut-out from the garment photo, placed on the drawn shape. */
  logo?: { src: string; placement: "left-chest"; widthCm: number };
  details: string[];
  source: "your photo" | "demo";
}

export const WARDROBE: Garment[] = [
  {
    id: "lee-abbey-polo",
    name: "Navy piqué polo",
    category: "top",
    type: "polo",
    fit: "regular",
    neckline: "polo-collar",
    sleeve: "short",
    length: "hip",
    color: "#232C45",
    trim: "#1A2136",
    logo: { src: "/try-on/lee-abbey-logo.png", placement: "left-chest", widthCm: 9 },
    details: ["Piqué cotton", "Two-button placket", "Ribbed sleeve cuffs", "Embroidered Lee Abbey London mark"],
    source: "your photo",
  },
  {
    id: "printed-shorts",
    name: "Printed lounge shorts",
    category: "bottom",
    type: "shorts",
    fit: "relaxed",
    length: "above-knee",
    color: "#A79D9F",
    trim: "#7C7173",
    pattern: { kind: "print", ink: "#3E3441" },
    details: ["Elastic waist", "Wave-and-type print", "Above-knee length"],
    source: "your photo",
  },
  {
    id: "bone-tee",
    name: "Heavyweight tee · Bone",
    category: "top",
    type: "tee",
    fit: "regular",
    neckline: "crew",
    sleeve: "short",
    length: "hip",
    color: "#EFEBE2",
    trim: "#E2DCCF",
    details: ["240 gsm cotton", "Ribbed crew neck"],
    source: "demo",
  },
  {
    id: "breton",
    name: "Breton long sleeve",
    category: "top",
    type: "long-sleeve",
    fit: "slim",
    neckline: "boat",
    sleeve: "long",
    length: "hip",
    color: "#E7E2D6",
    trim: "#2B3350",
    pattern: { kind: "stripe", color: "#2B3350", widthCm: 1.1, gapCm: 2.6 },
    details: ["Boat neck", "Ink stripe"],
    source: "demo",
  },
  {
    id: "ochre-tee",
    name: "Oversized tee · Ochre",
    category: "top",
    type: "tee",
    fit: "relaxed",
    neckline: "crew",
    sleeve: "short",
    length: "low-hip",
    color: "#DE9C31",
    trim: "#C9871F",
    details: ["Dropped shoulder", "Boxy cut"],
    source: "demo",
  },
];

/** Ease in centimetres added around the body. */
const EASE = { slim: 2, regular: 5, relaxed: 10 } as const;

function Fill({ g, uid }: { g: Garment; uid: string }) {
  const id = `${uid}-${g.id}`;
  if (g.pattern?.kind === "stripe") {
    const s = 3.55;
    const h = (g.pattern.widthCm + g.pattern.gapCm) * s;
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={8} height={h}>
        <rect width={8} height={h} fill={g.color} />
        <rect y={h - g.pattern.widthCm * s} width={8} height={g.pattern.widthCm * s} fill={g.pattern.color} />
      </pattern>
    );
  }
  if (g.pattern?.kind === "print") {
    const ink = g.pattern.ink;
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={44} height={30}>
        <rect width={44} height={30} fill={g.color} />
        <path d="M0 8 C 6 3, 12 13, 18 8 S 30 3, 36 8 S 44 13, 44 8" stroke={ink} strokeWidth={2.2} fill="none" opacity={0.85} />
        <path d="M0 23 C 6 18, 12 28, 18 23 S 30 18, 36 23 S 44 28, 44 23" stroke={ink} strokeWidth={1.4} fill="none" opacity={0.6} />
        <g fill={ink} opacity={0.75}>
          <rect x={4} y={13} width={3} height={4} rx={0.5} />
          <rect x={9} y={13} width={2} height={4} rx={0.5} />
          <rect x={13} y={13} width={3} height={4} rx={0.5} />
          <rect x={26} y={14} width={2} height={3.5} rx={0.5} />
          <rect x={30} y={14} width={3} height={3.5} rx={0.5} />
        </g>
      </pattern>
    );
  }
  return null;
}

function paint(g: Garment, uid: string) {
  return g.pattern ? `url(#${uid}-${g.id})` : g.color;
}

/** Shared side-shading so flat fills read as cloth around a body. */
function Defs({ uid }: { uid: string }) {
  return (
    <defs>
      <linearGradient id={`${uid}-side`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="black" stopOpacity="0.2" />
        <stop offset="0.22" stopColor="black" stopOpacity="0" />
        <stop offset="0.78" stopColor="black" stopOpacity="0" />
        <stop offset="1" stopColor="black" stopOpacity="0.2" />
      </linearGradient>
    </defs>
  );
}

function Top({ g, k, uid }: { g: Garment; k: Skeleton; uid: string }) {
  const { cx, headH, s } = k;
  const e = EASE[g.fit] * s * 0.32;
  const drop = g.fit === "relaxed" ? headH * 0.1 : 0;
  const hemY = g.length === "low-hip" ? k.hipY + headH * 0.48 : k.hipY + headH * 0.3;
  const wide = g.neckline === "boat";
  const neckX = k.neckHalf * (wide ? 1.75 : 1.2);
  const neckY = k.shoulderY - headH * 0.16;
  const bodyHalf = Math.max(k.chestHalf, k.waistHalf, k.hipHalf * 0.96);

  const side: Point[] = [
    { x: cx - neckX, y: neckY },
    { x: cx - k.shoulderHalf * 0.72 - e * 0.4, y: k.shoulderY - headH * 0.03 + drop * 0.3 },
    { x: cx - k.shoulderHalf - e * 0.6 - drop * 0.6, y: k.shoulderY + headH * 0.2 + drop },
    { x: cx - k.chestHalf - e, y: k.chestY + headH * 0.08 },
    { x: cx - Math.max(k.waistHalf, k.chestHalf * 0.9) - e, y: k.waistY },
    { x: cx - bodyHalf - e * 0.9, y: hemY },
  ];
  const dip = g.neckline === "polo-collar" ? headH * 0.24 : wide ? headH * 0.1 : headH * 0.2;
  const body = `M ${side[0].x} ${side[0].y}${smooth(side)} ${hemAndRightSide(side, cx, hemY)} Q ${cx} ${neckY + dip * 2} ${side[0].x} ${side[0].y} Z`;

  const sleeveT = g.sleeve === "long" ? 1 : g.fit === "relaxed" ? 0.34 : 0.26;
  // The sleeve hugs the shoulder and the ease opens toward the cuff, so loose fits flare instead of ballooning.
  const chain = upTo(k.arm, sleeveT);
  const sleeveRings: Ring[] = chain.map((p, i) => ({ ...p, r: p.r + 2.5 + e * (g.sleeve === "long" ? 0.3 : 0.5) * (i / Math.max(1, chain.length - 1)) }));
  const sleeves = [sleeveRings, sleeveRings.map((p) => mirror(p, cx))];
  const fill = paint(g, uid);
  const seam = shade(g.color, -0.22);

  return (
    <g data-garment-id={g.id}>
      {sleeves.map((rings, i) => {
        const end = rings[rings.length - 1];
        const prev = rings[rings.length - 2];
        const len = Math.hypot(end.x - prev.x, end.y - prev.y) || 1;
        const n = { x: -(end.y - prev.y) / len, y: (end.x - prev.x) / len };
        return (
          <g key={i}>
            <path d={tube(rings)} fill={fill} />
            <path d={tube(rings)} fill={`url(#${uid}-side)`} />
            <path d={`M ${end.x + n.x * end.r} ${end.y + n.y * end.r} L ${end.x - n.x * end.r} ${end.y - n.y * end.r}`} stroke={g.trim} strokeWidth={g.sleeve === "long" ? 7 : 5} strokeLinecap="round" />
          </g>
        );
      })}
      <path d={body} fill={fill} />
      <path d={body} fill={`url(#${uid}-side)`} />
      {/* Folds at the waist where the fabric gathers. */}
      <g stroke={seam} strokeWidth={1.4} fill="none" opacity={0.45} strokeLinecap="round">
        <path d={`M ${cx - k.chestHalf * 0.7} ${k.waistY - headH * 0.1} q ${headH * 0.12} ${headH * 0.25} ${headH * 0.05} ${headH * 0.5}`} />
        <path d={`M ${cx + k.chestHalf * 0.55} ${k.waistY} q ${-headH * 0.1} ${headH * 0.2} ${-headH * 0.02} ${headH * 0.4}`} />
      </g>
      <path d={`M ${cx - bodyHalf - e * 0.9 + 2} ${hemY - 3} Q ${cx} ${hemY + 4} ${cx + bodyHalf + e * 0.9 - 2} ${hemY - 3}`} stroke={g.trim} strokeWidth={2} fill="none" opacity={0.6} />

      {g.neckline === "crew" && <path d={`M ${cx - neckX} ${neckY} Q ${cx} ${neckY + dip * 2} ${cx + neckX} ${neckY}`} stroke={g.trim} strokeWidth={5} fill="none" strokeLinecap="round" />}
      {g.neckline === "boat" && <path d={`M ${cx - neckX} ${neckY} Q ${cx} ${neckY + dip * 2} ${cx + neckX} ${neckY}`} stroke={g.color} strokeWidth={4} fill="none" strokeLinecap="round" />}
      {g.neckline === "polo-collar" && <PoloCollar g={g} k={k} neckX={neckX} neckY={neckY} />}

      {g.logo && (
        <image
          href={g.logo.src}
          x={cx + k.chestHalf * 0.18}
          y={k.shoulderY + headH * 0.32}
          width={g.logo.widthCm * s}
          height={g.logo.widthCm * s * 0.3}
          preserveAspectRatio="xMinYMid meet"
        />
      )}
    </g>
  );
}

/** Curved hem across, then up the right side, after the left side has been drawn down to the hem. */
function hemAndRightSide(side: Point[], cx: number, hemY: number) {
  const right = side.map((p) => mirror(p, cx)).reverse();
  const hemR = right[0];
  return `Q ${cx} ${hemY + 6} ${hemR.x} ${hemR.y}${smooth(right)}`;
}

function PoloCollar({ g, k, neckX, neckY }: { g: Garment; k: Skeleton; neckX: number; neckY: number }) {
  const { cx, headH } = k;
  const placketTop = neckY + headH * 0.3;
  const placketBottom = placketTop + headH * 0.62;
  const collar = shade(g.color, 0.06);
  const edge = shade(g.color, -0.35);
  const flap = (dir: 1 | -1) => [
    { x: cx + dir * neckX * 0.95, y: neckY - headH * 0.06 },
    { x: cx + dir * neckX * 1.55, y: neckY + headH * 0.06 },
    { x: cx + dir * neckX * 1.05, y: neckY + headH * 0.42 },
    { x: cx + dir * 2, y: placketTop },
  ];
  return (
    <g>
      <rect x={cx - 7} y={placketTop - 2} width={14} height={placketBottom - placketTop} rx={2} fill={collar} stroke={edge} strokeWidth={1} />
      {[0.32, 0.72].map((t) => (
        <circle key={t} cx={cx} cy={placketTop + (placketBottom - placketTop) * t} r={2.4} fill={shade(g.color, 0.25)} />
      ))}
      {([-1, 1] as const).map((dir) => {
        const p = flap(dir);
        return <path key={dir} d={`M ${p[0].x} ${p[0].y} L ${p[1].x} ${p[1].y} L ${p[2].x} ${p[2].y} L ${p[3].x} ${p[3].y} Z`} fill={collar} stroke={edge} strokeWidth={1.2} strokeLinejoin="round" />;
      })}
    </g>
  );
}

function Bottom({ g, k, uid }: { g: Garment; k: Skeleton; uid: string }) {
  const { cx, headH, s } = k;
  const e = EASE[g.fit] * s * 0.32;
  const topY = k.waistY + headH * 0.32;
  const topHalf = (k.waistHalf + k.hipHalf) / 2 + e * 0.6;
  const hemY = k.crotchY + 17 * s;
  const t = (hemY - k.leg[0].y) / (k.kneeY - k.leg[0].y);
  const legAt = along(k.leg.slice(0, 3), Math.min(1, t * 0.98));
  const legR = legAt.r + e * 0.9;
  const fill = paint(g, uid);
  // Each leg opening is its own tube; the inseam stops short of the centre line so the legs read apart.
  const outline = symmetric([
    { x: cx - topHalf, y: topY },
    { x: cx - k.hipHalf - e, y: k.hipY },
    { x: legAt.x - legR, y: hemY },
    { x: legAt.x - legR * 0.2, y: hemY + 3 },
    { x: Math.min(cx - 4, legAt.x + legR * 0.75), y: hemY },
    { x: cx - 1, y: k.crotchY + headH * 0.06 },
  ], cx);
  const band = headH * 0.13;
  const edge = shade(g.color, -0.35);
  return (
    <g data-garment-id={g.id}>
      <path d={outline} fill={fill} />
      <path d={outline} fill={`url(#${uid}-side)`} />
      <path d={`M ${cx - topHalf} ${topY} Q ${cx} ${topY + 4} ${cx + topHalf} ${topY} L ${cx + topHalf + 1} ${topY + band} Q ${cx} ${topY + band + 4} ${cx - topHalf - 1} ${topY + band} Z`} fill={g.trim} />
      <g stroke={edge} strokeWidth={1.3} fill="none" opacity={0.7} strokeLinecap="round">
        <path d={`M ${cx} ${topY + band} q 3 ${headH * 0.3} -1 ${headH * 0.5}`} />
        <path d={`M ${cx - topHalf * 0.72} ${topY + band} q ${-headH * 0.04} ${headH * 0.22} ${-headH * 0.16} ${headH * 0.3}`} />
        <path d={`M ${cx + topHalf * 0.72} ${topY + band} q ${headH * 0.04} ${headH * 0.22} ${headH * 0.16} ${headH * 0.3}`} />
      </g>
    </g>
  );
}

/** Patterns and shading for every garment worn, rendered once per avatar. */
export function GarmentDefs({ items, uid }: { items: Garment[]; uid: string }) {
  return (
    <>
      <Defs uid={uid} />
      <defs>{items.map((g) => <Fill key={g.id} g={g} uid={uid} />)}</defs>
    </>
  );
}

export function GarmentShape({ g, k, uid }: { g: Garment; k: Skeleton; uid: string }) {
  return g.category === "top" ? <Top g={g} k={k} uid={uid} /> : <Bottom g={g} k={k} uid={uid} />;
}
