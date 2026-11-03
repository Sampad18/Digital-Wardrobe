import * as React from "react";
import { VIEW_H, VIEW_W, along, closed, mirror, mirrorRing, shade, symmetric, torsoPath, tube, type Point, type Ring, type Skeleton } from "./body";

type Tones = { base: string; dark: string; light: string; fabric: string };

function tones(skin: string): Tones {
  return { base: skin, dark: shade(skin, -0.55), light: shade(skin, 0.6), fabric: shade(skin, -0.14) };
}

/** Filters and lighting shared by the front and side renders. */
function Studio({ uid, k }: { uid: string; k: Skeleton }) {
  const H = k.floor - k.top;
  return (
    <defs>
      {/* User-space regions: a percentage region on a thin stroke crops the blur into a visible box. */}
      {([["bs", 1.4], ["bm", 3.6], ["bl", 8]] as const).map(([name, sd]) => (
        <filter key={name} id={`${uid}-${name}`} filterUnits="userSpaceOnUse" x={-100} y={-100} width={VIEW_W + 200} height={VIEW_H + 200}>
          <feGaussianBlur stdDeviation={sd} />
        </filter>
      ))}
      <radialGradient id={`${uid}-key`} gradientUnits="userSpaceOnUse" cx={k.cx - 30} cy={k.top + H * 0.22} r={H * 0.75}>
        <stop offset="0" stopColor="white" stopOpacity="0.22" />
        <stop offset="0.45" stopColor="white" stopOpacity="0" />
        <stop offset="1" stopColor="black" stopOpacity="0.22" />
      </radialGradient>
    </defs>
  );
}

/** A body part: flat fill plus a blurred inner rim, which is what makes flat shapes read as rounded volumes. */
function Part({ d, id, uid, t, fill, rim = 14, fadeTop }: { d: string; id: string; uid: string; t: Tones; fill?: string; rim?: number; fadeTop?: { y: number; len: number } }) {
  const clip = `${uid}-c-${id}`;
  const mask = `${uid}-m-${id}`;
  return (
    <g>
      <clipPath id={clip}><path d={d} /></clipPath>
      {/* Where a part grows out of another (an arm from the shoulder), its rim fades so no seam shows. */}
      {fadeTop && (
        <mask id={mask} maskUnits="userSpaceOnUse" x={-2000} y={-2000} width={4000} height={4000}>
          <linearGradient id={`${mask}-g`} gradientUnits="userSpaceOnUse" x1={0} y1={fadeTop.y} x2={0} y2={fadeTop.y + fadeTop.len}>
            <stop offset="0" stopColor="black" />
            <stop offset="1" stopColor="white" />
          </linearGradient>
          <rect x={-2000} y={-2000} width={4000} height={4000} fill={`url(#${mask}-g)`} />
        </mask>
      )}
      <path d={d} fill={fill ?? t.base} />
      <g clipPath={`url(#${clip})`} mask={fadeTop ? `url(#${mask})` : undefined}>
        <path d={d} fill="none" stroke={t.dark} strokeWidth={rim} opacity={0.42} filter={`url(#${uid}-bm)`} />
      </g>
    </g>
  );
}

function Line({ d, uid, color, w = 3, o = 0.35, blur = "bs" }: { d: string; uid: string; color: string; w?: number; o?: number; blur?: "bs" | "bm" | "bl" }) {
  return <path d={d} fill="none" stroke={color} strokeWidth={w} opacity={o} strokeLinecap="round" filter={`url(#${uid}-${blur})`} />;
}

/** Draws children for the left half and again mirrored for the right. */
function Both({ cx, children }: { cx: number; children: React.ReactNode }) {
  return (
    <>
      <g>{children}</g>
      <g transform={`translate(${cx * 2} 0) scale(-1 1)`}>{children}</g>
    </>
  );
}

const P = (p: Point) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;

/** Offset a point on a limb ring toward its outer (+1) or inner (-1) edge; 0 stays on the centre line. */
function edge(rings: Ring[], t: number, side: number, inset = 0.25): Point {
  const p = along(rings, t);
  const q = along(rings, Math.min(1, t + 0.02));
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const n = { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
  const r = p.r * (1 - inset);
  return { x: p.x + n.x * r * side, y: p.y + n.y * r * side };
}

function headPath(k: Skeleton) {
  const { cx, top, headH: h, headW: w } = k;
  return symmetric([
    { x: cx, y: top },
    { x: cx - w * 0.4, y: top + h * 0.12 },
    { x: cx - w * 0.5, y: top + h * 0.38 },
    { x: cx - w * 0.49, y: top + h * 0.58 },
    { x: cx - w * 0.42, y: top + h * 0.8 },
    { x: cx - w * 0.2, y: top + h * 0.97 },
    { x: cx, y: top + h },
  ], cx);
}

function briefsFront(k: Skeleton) {
  const { cx, headH: h } = k;
  return symmetric([
    { x: cx - k.hipHalf * 0.94, y: k.hipY - h * 0.3 },
    { x: cx - k.hipHalf * 1.02, y: k.hipY - h * 0.04 },
    { x: cx - k.hipHalf * 0.5, y: k.crotchY - h * 0.08 },
    { x: cx - k.hipHalf * 0.1, y: k.crotchY + h * 0.06 },
  ], cx);
}

function footFront(k: Skeleton): string {
  const a = k.leg[k.leg.length - 1];
  const fw = 9.5 * k.s;
  const r = a.r;
  return closed([
    { x: a.x + r * 0.95, y: a.y - 4 },
    { x: a.x - r * 0.95, y: a.y - 4 },
    { x: a.x - fw * 0.5, y: k.floor - 7 },
    { x: a.x - fw * 0.52, y: k.floor - 1 },
    { x: a.x + fw * 0.3, y: k.floor },
    { x: a.x + fw * 0.42, y: k.floor - 6 },
  ]);
}

function handPath(h: Skeleton["hand"]): string {
  // A relaxed hand: palm and closed fingers as one long oval, the thumb tucked on the body side.
  return closed([
    { x: h.x - h.rx * 0.9, y: h.y - h.ry * 0.9 },
    { x: h.x - h.rx, y: h.y - h.ry * 0.1 },
    { x: h.x - h.rx * 0.75, y: h.y + h.ry * 0.75 },
    { x: h.x, y: h.y + h.ry },
    { x: h.x + h.rx * 0.7, y: h.y + h.ry * 0.7 },
    { x: h.x + h.rx * 1.15, y: h.y + h.ry * 0.05 },
    { x: h.x + h.rx * 0.95, y: h.y - h.ry * 0.85 },
  ]);
}

/** Front view. Garments are passed as children and drawn on top using the same skeleton. */
export function Avatar({ k, skin, uid, children }: { k: Skeleton; skin: string; uid: string; children?: React.ReactNode }) {
  const t = tones(skin);
  const { cx, headH: h, headW: w, top, build, belly } = k;
  const rightArm = k.arm.map((p) => mirrorRing(p));
  const rightLeg = k.leg.map((p) => mirrorRing(p));
  const hands = [k.hand, { ...mirror(k.hand), angle: -k.hand.angle }];
  const torso = torsoPath(k);
  const head = headPath(k);
  // Even a little belly softens ab definition, so it fades well before the belly is large.
  const abs = build * Math.max(0, 1 - belly * 2.5) * 0.9;
  const leg = k.leg;
  const arm = k.arm;
  const bodyClip = `${uid}-body`;

  return (
    <g>
      <Studio uid={uid} k={k} />
      <clipPath id={bodyClip}>
        <path d={torso} />
        {[k.leg, rightLeg, k.arm, rightArm].map((r, i) => <path key={i} d={tube(r)} />)}
        <path d={head} />
      </clipPath>
      <ellipse cx={cx} cy={k.floor + 3} rx={k.hipHalf * 1.8} ry={7} fill="black" opacity={0.1} filter={`url(#${uid}-bm)`} />

      {/* Legs and feet */}
      <Part d={footFront(k)} id="fl" uid={uid} t={t} rim={8} />
      <g transform={`translate(${cx * 2} 0) scale(-1 1)`}><Part d={footFront(k)} id="fr" uid={uid} t={t} rim={8} /></g>
      <Part d={tube(leg)} id="ll" uid={uid} t={t} rim={18} />
      <Part d={tube(rightLeg)} id="lr" uid={uid} t={t} rim={18} />
      <g clipPath={`url(#${bodyClip})`}>
        <Both cx={cx}>
          {/* Outer quad sweep, inner teardrop above the knee, kneecap, inner calf, shin. */}
          <Line uid={uid} color={t.dark} w={4} o={0.22 + build * 0.15} blur="bm" d={`M ${P(edge(leg, 0.08, 1, 0.35))} Q ${P(edge(leg, 0.25, 1, 0.3))} ${P(edge(leg, 0.42, 1, 0.45))}`} />
          <Line uid={uid} color={t.dark} w={3.5} o={0.25 + build * 0.15} blur="bm" d={`M ${P(edge(leg, 0.28, -1, 0.55))} Q ${P(edge(leg, 0.4, -1, 0.1))} ${P(edge(leg, 0.47, -1, 0.5))}`} />
          <Line uid={uid} color={t.light} w={9} o={0.35} blur="bl" d={`M ${P(edge(leg, 0.15, 1, 0.9))} L ${P(edge(leg, 0.38, 1, 0.9))}`} />
          <ellipse cx={along(leg, 0.5).x} cy={along(leg, 0.5).y - h * 0.04} rx={along(leg, 0.5).r * 0.5} ry={along(leg, 0.5).r * 0.62} fill={t.light} opacity={0.3} filter={`url(#${uid}-bm)`} />
          <Line uid={uid} color={t.dark} w={3} o={0.3} blur="bm" d={`M ${P(edge(leg, 0.52, 1, 0.5))} Q ${P(along(leg, 0.54))} ${P(edge(leg, 0.52, -1, 0.5))}`} />
          <Line uid={uid} color={t.dark} w={4} o={0.2 + build * 0.15} blur="bm" d={`M ${P(edge(leg, 0.58, -1, 0.3))} Q ${P(edge(leg, 0.64, -1, 0.05))} ${P(edge(leg, 0.74, -1, 0.35))}`} />
          <Line uid={uid} color={t.light} w={5} o={0.3} blur="bm" d={`M ${P(edge(leg, 0.58, 1, 0.75))} L ${P(edge(leg, 0.9, 1, 0.75))}`} />
        </Both>
      </g>

      {/* Torso */}
      <Part d={torso} id="t" uid={uid} t={t} rim={20} />
      <g clipPath={`url(#${bodyClip})`}><Part d={briefsFront(k)} id="b" uid={uid} t={t} fill={t.fabric} rim={10} /></g>
      <g clipPath={`url(#${bodyClip})`}>
        <path d={`M ${cx - k.hipHalf * 0.95} ${k.hipY - h * 0.25} Q ${cx} ${k.hipY - h * 0.22} ${cx + k.hipHalf * 0.95} ${k.hipY - h * 0.25}`} stroke={t.dark} strokeWidth={1.5} opacity={0.35} fill="none" />
        <Line uid={uid} color={t.dark} w={2.5} o={0.2} blur="bm" d={`M ${cx} ${k.shoulderY + h * 0.15} L ${cx} ${k.chestY + h * 0.18}`} />
        <Line uid={uid} color={t.dark} w={2} o={abs * 0.5} d={`M ${cx} ${k.chestY + h * 0.3} L ${cx} ${k.waistY + h * 0.05}`} />
        <ellipse cx={cx} cy={k.waistY + h * 0.14} rx={2.4} ry={3.2} fill={t.dark} opacity={0.45} filter={`url(#${uid}-bs)`} />
        <Both cx={cx}>
          {/* Collarbone, neck cord, pec edge, deltoid split, abs, serratus, the V at the hip. */}
          <Line uid={uid} color={t.dark} w={2.5} o={0.32} d={`M ${cx - k.neckHalf * 0.55} ${k.shoulderY - h * 0.08} Q ${cx - k.shoulderHalf * 0.45} ${k.shoulderY - h * 0.02} ${cx - k.shoulderHalf * 0.8} ${k.shoulderY - h * 0.05}`} />
          <Line uid={uid} color={t.light} w={4} o={0.4} blur="bm" d={`M ${cx - k.neckHalf * 0.6} ${k.shoulderY - h * 0.13} Q ${cx - k.shoulderHalf * 0.45} ${k.shoulderY - h * 0.07} ${cx - k.shoulderHalf * 0.78} ${k.shoulderY - h * 0.1}`} />
          <Line uid={uid} color={t.dark} w={2.5} o={0.28} blur="bm" d={`M ${cx - k.neckHalf * 0.85} ${k.chinY - h * 0.08} L ${cx - k.neckHalf * 0.2} ${k.shoulderY - h * 0.12}`} />
          <Line uid={uid} color={t.dark} w={5} o={0.3 + build * 0.25} blur="bm" d={`M ${cx - 1} ${k.chestY + h * 0.14} Q ${cx - k.chestHalf * 0.45} ${k.chestY + h * 0.34} ${cx - k.chestHalf * 0.86} ${k.chestY - h * 0.06}`} />
          <ellipse cx={cx - k.chestHalf * 0.45} cy={k.chestY - h * 0.05} rx={k.chestHalf * 0.38} ry={h * 0.22} fill={t.light} opacity={0.32} filter={`url(#${uid}-bl)`} />
          <Line uid={uid} color={t.dark} w={3} o={0.3} blur="bm" d={`M ${cx - k.shoulderHalf * 0.74} ${k.shoulderY + h * 0.02} Q ${cx - k.chestHalf * 0.8} ${k.chestY - h * 0.25} ${cx - k.chestHalf * 0.86} ${k.chestY - h * 0.02}`} />
          {[0.42, 0.66, 0.9].map((r) => (
            <Line key={r} uid={uid} color={t.dark} w={2.5} o={abs * 0.45} d={`M ${cx - 1} ${k.chestY + h * r} Q ${cx - k.waistHalf * 0.25} ${k.chestY + h * (r + 0.05)} ${cx - k.waistHalf * 0.46} ${k.chestY + h * (r - 0.02)}`} />
          ))}
          {[0.42, 0.66, 0.9].map((r) => (
            <ellipse key={r} cx={cx - k.waistHalf * 0.22} cy={k.chestY + h * (r + 0.13)} rx={k.waistHalf * 0.17} ry={h * 0.08} fill={t.light} opacity={abs * 0.35} filter={`url(#${uid}-bm)`} />
          ))}
          <Line uid={uid} color={t.dark} w={3} o={abs * 0.4} blur="bm" d={`M ${cx - k.chestHalf * 0.52} ${k.chestY + h * 0.36} Q ${cx - k.waistHalf * 0.56} ${k.waistY} ${cx - k.waistHalf * 0.44} ${k.hipY - h * 0.25}`} />
          {[0.3, 0.48, 0.66].map((r) => (
            <Line key={r} uid={uid} color={t.dark} w={2.5} o={build * 0.22} blur="bm" d={`M ${cx - k.chestHalf * 0.9} ${k.chestY + h * r} l ${k.chestHalf * 0.14} ${-h * 0.06}`} />
          ))}
          <Line uid={uid} color={t.dark} w={4} o={0.15 + build * 0.3} blur="bm" d={`M ${cx - k.hipHalf * 0.84} ${k.hipY - h * 0.35} Q ${cx - k.hipHalf * 0.55} ${k.hipY} ${cx - k.hipHalf * 0.22} ${k.hipY + h * 0.1}`} />
          <Line uid={uid} color={t.dark} w={7} o={0.15} blur="bl" d={`M ${cx - k.waistHalf * 0.95} ${k.chestY + h * 0.4} L ${cx - k.hipHalf * 0.92} ${k.hipY - h * 0.1}`} />
        </Both>
        {belly > 0.05 && (
          <>
            <ellipse cx={cx} cy={k.waistY + h * 0.05} rx={k.waistHalf * 0.75} ry={h * (0.35 + belly * 0.15)} fill={t.light} opacity={belly * 0.28} filter={`url(#${uid}-bl)`} />
            <Line uid={uid} color={t.dark} w={4} o={belly * 0.45} blur="bm" d={`M ${cx - k.waistHalf * 0.8} ${k.waistY + h * 0.32} Q ${cx} ${k.hipY - h * 0.08 + belly * h * 0.12} ${cx + k.waistHalf * 0.8} ${k.waistY + h * 0.32}`} />
          </>
        )}
        <path d={torso} fill={`url(#${uid}-key)`} />
      </g>

      {/* Neck and head */}
      <Both cx={cx}>
        <ellipse cx={cx - w * 0.5} cy={top + h * 0.53} rx={w * 0.08} ry={h * 0.12} fill={t.base} />
        <ellipse cx={cx - w * 0.5} cy={top + h * 0.53} rx={w * 0.045} ry={h * 0.08} fill={t.dark} opacity={0.3} filter={`url(#${uid}-bs)`} />
      </Both>
      <ellipse cx={cx} cy={k.chinY + h * 0.02} rx={k.neckHalf * 0.95} ry={h * 0.08} fill={t.dark} opacity={0.35} filter={`url(#${uid}-bm)`} />
      <Part d={head} id="h" uid={uid} t={t} rim={12} />
      <g clipPath={`url(#${bodyClip})`}>
        <Both cx={cx}>
          {/* Brow, eye socket, cheekbone and jaw: sculpted, not drawn as features. */}
          <Line uid={uid} color={t.dark} w={3} o={0.4} blur="bm" d={`M ${cx - w * 0.06} ${top + h * 0.47} Q ${cx - w * 0.2} ${top + h * 0.43} ${cx - w * 0.36} ${top + h * 0.47}`} />
          <ellipse cx={cx - w * 0.2} cy={top + h * 0.52} rx={w * 0.11} ry={h * 0.045} fill={t.dark} opacity={0.4} filter={`url(#${uid}-bs)`} />
          <Line uid={uid} color={t.dark} w={4} o={0.25} blur="bm" d={`M ${cx - w * 0.4} ${top + h * 0.66} Q ${cx - w * 0.3} ${top + h * 0.74} ${cx - w * 0.22} ${top + h * 0.72}`} />
          <ellipse cx={cx - w * 0.3} cy={top + h * 0.6} rx={w * 0.09} ry={h * 0.05} fill={t.light} opacity={0.35} filter={`url(#${uid}-bm)`} />
        </Both>
        <Line uid={uid} color={t.dark} w={2.5} o={0.38} d={`M ${cx + w * 0.04} ${top + h * 0.55} L ${cx + w * 0.07} ${top + h * 0.7}`} />
        <Line uid={uid} color={t.light} w={3} o={0.45} d={`M ${cx - w * 0.01} ${top + h * 0.54} L ${cx - w * 0.01} ${top + h * 0.69}`} />
        <ellipse cx={cx} cy={top + h * 0.735} rx={w * 0.09} ry={h * 0.025} fill={t.dark} opacity={0.4} filter={`url(#${uid}-bs)`} />
        <Line uid={uid} color={t.dark} w={2} o={0.45} d={`M ${cx - w * 0.13} ${top + h * 0.825} Q ${cx} ${top + h * 0.835} ${cx + w * 0.13} ${top + h * 0.825}`} />
        <ellipse cx={cx} cy={top + h * 0.91} rx={w * 0.1} ry={h * 0.04} fill={t.light} opacity={0.35} filter={`url(#${uid}-bm)`} />
        <ellipse cx={cx - w * 0.1} cy={top + h * 0.16} rx={w * 0.25} ry={h * 0.1} fill={t.light} opacity={0.35} filter={`url(#${uid}-bm)`} />
        <path d={head} fill={`url(#${uid}-key)`} />
      </g>

      {/* Arms and hands */}
      {hands.map((hand, i) => (
        <g key={i}>
          <Part d={handPath(hand)} id={`hd${i}`} uid={uid} t={t} rim={7} />
          {/* Finger separations on the lower half of the hand. */}
          <g transform={`rotate(${hand.angle} ${hand.x} ${hand.y})`}>
            {[-0.4, 0, 0.4].map((o) => (
              <Line key={o} uid={uid} color={t.dark} w={1.2} o={0.35} d={`M ${hand.x + hand.rx * o} ${hand.y + hand.ry * 0.1} L ${hand.x + hand.rx * o * 1.05} ${hand.y + hand.ry * 0.85}`} />
            ))}
          </g>
        </g>
      ))}
      <Part d={tube(arm)} id="al" uid={uid} t={t} rim={14} fadeTop={{ y: arm[0].y - arm[0].r * 0.6, len: arm[0].r * 2.4 }} />
      <Part d={tube(rightArm)} id="ar" uid={uid} t={t} rim={14} fadeTop={{ y: arm[0].y - arm[0].r * 0.6, len: arm[0].r * 2.4 }} />
      <g clipPath={`url(#${bodyClip})`}>
        <Both cx={cx}>
          {/* Deltoid cap, biceps, elbow, forearm. */}
          <Line uid={uid} color={t.dark} w={3} o={0.3 + build * 0.15} blur="bm" d={`M ${P(edge(arm, 0.08, 1, 0.2))} Q ${P(edge(arm, 0.22, 1, 0.1))} ${P(edge(arm, 0.25, -1, 0.4))}`} />
          <ellipse cx={along(arm, 0.08).x - 2} cy={along(arm, 0.08).y - 2} rx={along(arm, 0.08).r * 0.6} ry={along(arm, 0.08).r * 0.5} fill={t.light} opacity={0.4} filter={`url(#${uid}-bm)`} />
          <Line uid={uid} color={t.light} w={6} o={0.35} blur="bm" d={`M ${P(edge(arm, 0.3, -1, 0.5))} L ${P(edge(arm, 0.43, -1, 0.5))}`} />
          <Line uid={uid} color={t.dark} w={3} o={0.3} blur="bm" d={`M ${P(edge(arm, 0.5, -1, 0.2))} Q ${P(along(arm, 0.52))} ${P(edge(arm, 0.5, 1, 0.6))}`} />
          <Line uid={uid} color={t.dark} w={3} o={0.2 + build * 0.15} blur="bm" d={`M ${P(edge(arm, 0.54, 1, 0.35))} Q ${P(edge(arm, 0.66, 0, 0))} ${P(edge(arm, 0.82, -1, 0.3))}`} />
        </Both>
        {[arm, rightArm].map((a, i) => <path key={i} d={tube(a)} fill={`url(#${uid}-key)`} />)}
      </g>

      {children}
    </g>
  );
}

/** Side view, facing right. Shows depth: chest, belly and seat. */
export function SideAvatar({ k, skin, uid }: { k: Skeleton; skin: string; uid: string }) {
  const t = tones(skin);
  const { cx, headH: h, top, s, build, belly } = k;
  const H = k.floor - k.top;
  const headD = h * 0.9;
  const neckD = k.neckHalf * 2 * 0.95;
  const thighD = k.hipHalf * 0.98;
  const kneeD = (4.9 + build * 0.5) * s * 2 * 0.95;
  const calfD = (5.2 + build * 1.8) * s * 2;
  const ankleD = 2.9 * s * 2 * 1.1;
  const footLen = H * 0.15;
  const { chestD, waistD, hipD, bellyPx, chestY, waistY, hipY, crotchY, kneeY, ankleY, shoulderY, chinY, floor } = k;

  const body = closed([
    { x: cx - neckD * 0.3, y: chinY - h * 0.32 },
    { x: cx - neckD * 0.5, y: chinY + h * 0.05 },
    { x: cx - neckD * 0.6, y: shoulderY - h * 0.12 },
    { x: cx - chestD * 0.5, y: chestY - h * 0.2 },
    { x: cx - chestD * 0.46, y: chestY + h * 0.3 },
    { x: cx - waistD * 0.36, y: waistY + h * 0.1 },
    { x: cx - hipD * 0.42, y: hipY - h * 0.1 },
    { x: cx - hipD * 0.47, y: hipY + h * 0.2 },
    { x: cx - thighD * 0.5, y: crotchY + h * 0.14 },
    { x: cx - thighD * 0.46, y: (crotchY + kneeY) / 2 },
    { x: cx - kneeD * 0.45, y: kneeY },
    { x: cx - calfD * 0.62, y: kneeY + (ankleY - kneeY) * 0.25 },
    { x: cx - ankleD * 0.7, y: kneeY + (ankleY - kneeY) * 0.72 },
    { x: cx - ankleD * 0.55, y: ankleY - h * 0.05 },
    { x: cx - ankleD * 0.85, y: floor - 7 },
    { x: cx - ankleD * 0.6, y: floor },
    { x: cx + footLen * 0.66, y: floor },
    { x: cx + footLen * 0.74, y: floor - 5 },
    { x: cx + footLen * 0.55, y: floor - 11 },
    { x: cx + ankleD * 0.65, y: ankleY + h * 0.03 },
    { x: cx + ankleD * 0.42, y: ankleY - h * 0.12 },
    { x: cx + kneeD * 0.32, y: kneeY + (ankleY - kneeY) * 0.5 },
    { x: cx + kneeD * 0.48, y: kneeY + h * 0.14 },
    { x: cx + kneeD * 0.56, y: kneeY - h * 0.03 },
    { x: cx + thighD * 0.5, y: kneeY - (kneeY - crotchY) * 0.38 },
    { x: cx + thighD * 0.5, y: crotchY - h * 0.08 },
    { x: cx + hipD * 0.4 + bellyPx * 0.45, y: hipY - h * 0.08 },
    { x: cx + waistD * 0.5 + bellyPx, y: waistY + h * 0.1 + belly * h * 0.1 },
    { x: cx + chestD * 0.46 + bellyPx * 0.25, y: chestY + h * 0.45 },
    { x: cx + chestD * 0.52, y: chestY + h * 0.2 },
    { x: cx + chestD * 0.56, y: chestY - h * 0.02 },
    { x: cx + chestD * 0.42, y: shoulderY + h * 0.1 },
    { x: cx + neckD * 0.42, y: shoulderY - h * 0.14 },
    { x: cx + neckD * 0.5, y: chinY + h * 0.02 },
    { x: cx + neckD * 0.3, y: chinY - h * 0.3 },
  ]);
  const head = closed([
    { x: cx - headD * 0.52, y: top + h * 0.45 },
    { x: cx - headD * 0.3, y: top + h * 0.08 },
    { x: cx + headD * 0.08, y: top },
    { x: cx + headD * 0.4, y: top + h * 0.2 },
    { x: cx + headD * 0.5, y: top + h * 0.44 },
    { x: cx + headD * 0.47, y: top + h * 0.52 },
    { x: cx + headD * 0.62, y: top + h * 0.67 },
    { x: cx + headD * 0.5, y: top + h * 0.72 },
    { x: cx + headD * 0.52, y: top + h * 0.8 },
    { x: cx + headD * 0.48, y: top + h * 0.93 },
    { x: cx + headD * 0.2, y: top + h * 1.0 },
    { x: cx - headD * 0.15, y: top + h * 0.86 },
    { x: cx - headD * 0.42, y: top + h * 0.72 },
  ]);
  const briefs = closed([
    { x: cx - hipD * 0.5, y: hipY - h * 0.22 },
    { x: cx + hipD * 0.45 + bellyPx * 0.45, y: hipY - h * 0.2 },
    { x: cx + thighD * 0.55, y: crotchY + h * 0.02 },
    { x: cx - thighD * 0.2, y: crotchY + h * 0.12 },
    { x: cx - thighD * 0.55, y: crotchY + h * 0.2 },
    { x: cx - hipD * 0.52, y: hipY + h * 0.1 },
  ]);

  const upperR = k.arm[0].r;
  const joint = { x: cx - chestD * 0.08, y: shoulderY + upperR * 0.55 };
  const elbow = { x: cx - chestD * 0.14, y: k.arm[2].y };
  const wrist = { x: cx + 6, y: k.arm[4].y };
  const sideArm: Ring[] = [
    { ...joint, r: upperR * 1.15 },
    { x: (joint.x + elbow.x) / 2, y: (joint.y + elbow.y) / 2, r: upperR, rl: upperR * 0.95, rr: upperR * 1.08 },
    { ...elbow, r: k.arm[2].r },
    { x: elbow.x + (wrist.x - elbow.x) * 0.3, y: elbow.y + (wrist.y - elbow.y) * 0.3, r: k.arm[3].r },
    { ...wrist, r: k.arm[4].r * 1.1 },
  ];
  const hand = { x: wrist.x + 3, y: wrist.y + k.hand.ry * 0.95, rx: k.hand.rx * 1.25, ry: k.hand.ry, angle: -8 };
  const clip = `${uid}-side`;

  return (
    <g>
      <Studio uid={uid} k={k} />
      <clipPath id={clip}><path d={body} /><path d={head} /><path d={tube(sideArm)} /></clipPath>
      <ellipse cx={cx + footLen * 0.1} cy={floor + 3} rx={footLen * 0.9} ry={7} fill="black" opacity={0.1} filter={`url(#${uid}-bm)`} />
      <Part d={body} id="sb" uid={uid} t={t} rim={20} />
      <g clipPath={`url(#${clip})`}><Part d={briefs} id="sbr" uid={uid} t={t} fill={t.fabric} rim={10} /></g>
      <g clipPath={`url(#${clip})`}>
        <Line uid={uid} color={t.dark} w={4} o={0.3 + build * 0.2} blur="bm" d={`M ${cx + chestD * 0.5} ${chestY + h * 0.22} Q ${cx + chestD * 0.2} ${chestY + h * 0.28} ${cx + chestD * 0.05} ${chestY + h * 0.1}`} />
        <Line uid={uid} color={t.dark} w={4} o={0.3} blur="bm" d={`M ${cx - thighD * 0.55} ${crotchY + h * 0.12} Q ${cx - thighD * 0.2} ${crotchY + h * 0.2} ${cx} ${crotchY + h * 0.12}`} />
        <Line uid={uid} color={t.light} w={8} o={0.3} blur="bl" d={`M ${cx + thighD * 0.35} ${crotchY} L ${cx + kneeD * 0.4} ${kneeY - h * 0.2}`} />
        <Line uid={uid} color={t.dark} w={4} o={0.25 + build * 0.15} blur="bm" d={`M ${cx - kneeD * 0.2} ${kneeY + h * 0.1} Q ${cx - calfD * 0.2} ${kneeY + (ankleY - kneeY) * 0.3} ${cx - ankleD * 0.3} ${kneeY + (ankleY - kneeY) * 0.7}`} />
        <Line uid={uid} color={t.dark} w={3} o={0.3} blur="bm" d={`M ${cx + kneeD * 0.2} ${kneeY - h * 0.1} Q ${cx + kneeD * 0.55} ${kneeY} ${cx + kneeD * 0.25} ${kneeY + h * 0.12}`} />
        {belly > 0.05 && <Line uid={uid} color={t.dark} w={5} o={belly * 0.4} blur="bm" d={`M ${cx + waistD * 0.1} ${hipY - h * 0.12} Q ${cx + waistD * 0.35 + bellyPx * 0.6} ${hipY - h * 0.05} ${cx + hipD * 0.4 + bellyPx * 0.45} ${hipY - h * 0.15}`} />}
        <path d={body} fill={`url(#${uid}-key)`} />
      </g>
      <Part d={head} id="sh" uid={uid} t={t} rim={12} />
      <g clipPath={`url(#${clip})`}>
        <ellipse cx={cx - headD * 0.06} cy={top + h * 0.56} rx={headD * 0.09} ry={h * 0.12} fill={t.dark} opacity={0.3} filter={`url(#${uid}-bs)`} />
        <ellipse cx={cx + headD * 0.36} cy={top + h * 0.52} rx={headD * 0.08} ry={h * 0.04} fill={t.dark} opacity={0.35} filter={`url(#${uid}-bs)`} />
        <Line uid={uid} color={t.dark} w={3} o={0.3} blur="bm" d={`M ${cx + headD * 0.1} ${top + h * 0.95} Q ${cx - headD * 0.1} ${top + h * 0.85} ${cx - headD * 0.3} ${top + h * 0.78}`} />
        <path d={head} fill={`url(#${uid}-key)`} />
      </g>
      <Part d={handPath(hand)} id="shd" uid={uid} t={t} rim={7} />
      <Part d={tube(sideArm)} id="sa" uid={uid} t={t} rim={14} />
      <g clipPath={`url(#${clip})`}>
        <Line uid={uid} color={t.dark} w={3} o={0.3} blur="bm" d={`M ${joint.x - upperR * 0.9} ${joint.y + upperR * 1.6} Q ${joint.x} ${joint.y + upperR * 2.1} ${joint.x + upperR * 0.9} ${joint.y + upperR * 1.5}`} />
        <path d={tube(sideArm)} fill={`url(#${uid}-key)`} />
      </g>
    </g>
  );
}
