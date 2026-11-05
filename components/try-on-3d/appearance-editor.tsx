"use client";

import * as React from "react";
import type { BodyMeasurements } from "@/components/try-on/body";
import {
  BODY_TYPES, DEFAULT_APPEARANCE, EYE_COLORS, FACE_SHAPES, HAIR_COLORS, HAIR_STYLES, MOUTH_TYPES, MUSTACHES,
  type Appearance, type EyeColor, type HairColor, type HairStyle, type MouthType,
} from "./appearance";

export type EditorTab = "face" | "body";

const chip = "rounded-full px-3 py-1.5 text-xs font-medium capitalize text-muted-foreground ring-1 ring-black/10 outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground aria-pressed:bg-[#232C45] aria-pressed:text-white aria-pressed:ring-[#232C45]";
const quietButton = "text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-foreground";

function Slider({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
      <span>{label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{format(value)}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="col-span-2 h-1.5 w-full cursor-pointer accent-[#232C45]" />
    </label>
  );
}

/** A -1..1 appearance slider shown as -100..+100. */
function Bipolar({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return <Slider label={label} value={Math.round(value * 100)} min={-100} max={100} format={(v) => (v > 0 ? `+${v}` : `${v}`)} onChange={(v) => onChange(v / 100)} />;
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3.5 border-t border-black/[0.06] pt-4 first:border-t-0 first:pt-0">
      <legend className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function Choices<T extends string>({ label, options, value, onChange, render }: {
  label: string; options: readonly T[]; value: T | null; onChange: (v: T) => void; render?: (v: T) => React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={chip}>
          {render ? render(o) : o}
        </button>
      ))}
    </div>
  );
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

export function AppearanceEditor({ tab, onTab, appearance, onAppearance, body, onBody, onResetBody }: {
  tab: EditorTab;
  onTab: (t: EditorTab) => void;
  appearance: Appearance;
  /** Takes an updater, so quick successive changes never overwrite each other. */
  onAppearance: React.Dispatch<React.SetStateAction<Appearance>>;
  body: BodyMeasurements;
  onBody: (b: BodyMeasurements) => void;
  onResetBody: () => void;
}) {
  const a = appearance;
  const set = <K extends keyof Appearance>(key: K, patch: Partial<Appearance[K]> | Appearance[K]) =>
    onAppearance((prev) => ({ ...prev, [key]: typeof patch === "object" ? { ...(prev[key] as object), ...patch } : patch }));
  const bodyType = BODY_TYPES.find((t) => near(t.weight, a.weight) && near(t.muscle, a.muscle))?.name ?? null;
  const mouthType = (Object.keys(MOUTH_TYPES) as MouthType[]).find((m) => Object.entries(MOUTH_TYPES[m]).every(([k, v]) => near(v, a.mouth[k as keyof Appearance["mouth"]]))) ?? null;
  const cm = (key: keyof BodyMeasurements, label: string, min: number, max: number) => (
    <Slider label={label} value={body[key] as number} min={min} max={max} format={(v) => `${v} cm`} onChange={(v) => onBody({ ...body, [key]: v })} />
  );

  return (
    <section aria-label="Edit mannequin" className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Edit" className="inline-flex rounded-full bg-black/[0.05] p-1 text-xs font-medium">
          {(["face", "body"] as const).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => onTab(t)} className="rounded-full px-4 py-1.5 capitalize text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground aria-selected:bg-white aria-selected:text-foreground aria-selected:shadow-sm">
              {t}
            </button>
          ))}
        </div>
        {tab === "face" ? (
          <button type="button" className={quietButton} onClick={() => onAppearance((prev) => ({ ...DEFAULT_APPEARANCE, sex: prev.sex, weight: prev.weight, muscle: prev.muscle, hair: prev.hair, hairColor: prev.hairColor }))}>Reset face</button>
        ) : (
          <button type="button" className={quietButton} onClick={onResetBody}>Reset to my measurements</button>
        )}
      </div>

      {tab === "face" ? (
        <div role="tabpanel" aria-label="Face" className="mt-5 flex flex-col gap-5">
          <Group title="Hair">
            <Choices label="Hairstyle" options={Object.keys(HAIR_STYLES) as HairStyle[]} value={a.hair} onChange={(hair) => set("hair", hair)} render={(h) => HAIR_STYLES[h]} />
            <div className="flex flex-col gap-2 text-sm">
              <span>Hair colour</span>
              <div role="group" aria-label="Hair colour" className="flex flex-wrap gap-2">
                {(Object.keys(HAIR_COLORS) as HairColor[]).map((c) => (
                  <button key={c} type="button" aria-label={c} title={c} aria-pressed={a.hairColor === c} onClick={() => set("hairColor", c)} className="size-7 rounded-full outline-none ring-1 ring-black/10 ring-offset-2 ring-offset-white transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-foreground aria-pressed:ring-2 aria-pressed:ring-[#232C45]" style={{ background: HAIR_COLORS[c] }} />
                ))}
              </div>
            </div>
          </Group>
          <Group title="Face structure">
            <Choices label="Face shape" options={FACE_SHAPES} value={a.face.shape} onChange={(shape) => set("face", { shape })} />
            <Bipolar label="Face width" value={a.face.width} onChange={(width) => set("face", { width })} />
            <Bipolar label="Fullness" value={a.face.fullness} onChange={(fullness) => set("face", { fullness })} />
          </Group>
          <Group title="Nose">
            <Bipolar label="Width" value={a.nose.width} onChange={(width) => set("nose", { width })} />
            <Bipolar label="Length" value={a.nose.length} onChange={(length) => set("nose", { length })} />
            <Bipolar label="Bridge hump" value={a.nose.hump} onChange={(hump) => set("nose", { hump })} />
            <Bipolar label="Tip up or down" value={a.nose.tip} onChange={(tip) => set("nose", { tip })} />
            <Bipolar label="Nostril width" value={a.nose.nostrils} onChange={(nostrils) => set("nose", { nostrils })} />
            <Bipolar label="Size" value={a.nose.size} onChange={(size) => set("nose", { size })} />
          </Group>
          <Group title="Eyes">
            <Bipolar label="Eye width" value={a.eyes.size} onChange={(size) => set("eyes", { size })} />
            <Bipolar label="Distance between eyes" value={a.eyes.distance} onChange={(distance) => set("eyes", { distance })} />
            <div className="flex flex-col gap-2 text-sm">
              <span>Eye colour</span>
              <div role="group" aria-label="Eye colour" className="flex flex-wrap gap-2">
                {(Object.keys(EYE_COLORS) as EyeColor[]).map((c) => (
                  <button key={c} type="button" aria-label={c} title={c} aria-pressed={a.eyes.color === c} onClick={() => set("eyes", { color: c })} className="size-7 rounded-full outline-none ring-offset-2 ring-offset-white transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-foreground aria-pressed:ring-2 aria-pressed:ring-[#232C45]" style={{ background: `radial-gradient(circle, #0B0908 0 22%, ${EYE_COLORS[c]} 24% 70%, #1A1410 74%)` }} />
                ))}
              </div>
            </div>
          </Group>
          <Group title="Mouth">
            <Choices label="Mouth type" options={Object.keys(MOUTH_TYPES) as MouthType[]} value={mouthType} onChange={(m) => set("mouth", { ...MOUTH_TYPES[m] })} />
            <Bipolar label="Width" value={a.mouth.width} onChange={(width) => set("mouth", { width })} />
            <Bipolar label="Height" value={a.mouth.height} onChange={(height) => set("mouth", { height })} />
            <Bipolar label="Upper lip" value={a.mouth.upperLip} onChange={(upperLip) => set("mouth", { upperLip })} />
            <Bipolar label="Lower lip" value={a.mouth.lowerLip} onChange={(lowerLip) => set("mouth", { lowerLip })} />
            <Bipolar label="Corners" value={a.mouth.corners} onChange={(corners) => set("mouth", { corners })} />
          </Group>
          <Group title="Chin and jaw">
            <Bipolar label="Prominence" value={a.chin.prominence} onChange={(prominence) => set("chin", { prominence })} />
            <Bipolar label="Chin width" value={a.chin.width} onChange={(width) => set("chin", { width })} />
            <Bipolar label="Chin height" value={a.chin.height} onChange={(height) => set("chin", { height })} />
            <Bipolar label="Jaw width" value={a.chin.jaw} onChange={(jaw) => set("chin", { jaw })} />
            <Slider label="Pointed" value={Math.round(a.chin.pointed * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => set("chin", { pointed: v / 100 })} />
          </Group>
          <Group title="Mustache">
            <Choices label="Mustache" options={MUSTACHES} value={a.mustache} onChange={(mustache) => set("mustache", mustache)} />
          </Group>
        </div>
      ) : (
        <div role="tabpanel" aria-label="Body" className="mt-5 flex flex-col gap-5">
          <Group title="Body type">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span id="sex-label">Body</span>
              <div role="radiogroup" aria-labelledby="sex-label" className="inline-flex rounded-full bg-black/[0.05] p-1 text-xs font-medium">
                {(["Male", "Female"] as const).map((label, value) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    // Older saved profiles may hold an in-between value; it reads as the nearer side.
                    aria-checked={Math.round(a.sex) === value}
                    onClick={() => set("sex", value)}
                    className="rounded-full px-4 py-1.5 text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground aria-checked:bg-white aria-checked:text-foreground aria-checked:shadow-sm"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Choices label="Body type" options={BODY_TYPES.map((t) => t.name)} value={bodyType} onChange={(name) => { const t = BODY_TYPES.find((x) => x.name === name)!; onAppearance((prev) => ({ ...prev, weight: t.weight, muscle: t.muscle })); }} />
            <Bipolar label="Weight" value={a.weight} onChange={(weight) => set("weight", weight)} />
            <Bipolar label="Muscle" value={a.muscle} onChange={(muscle) => set("muscle", muscle)} />
          </Group>
          <Group title="Measurements">
            {cm("heightCm", "Height", 150, 200)}
            {cm("shoulderCm", "Shoulder width", 38, 58)}
            {cm("chestCm", "Chest", 80, 130)}
            {cm("waistCm", "Waist", 64, 120)}
            {cm("hipCm", "Hips", 80, 125)}
            {cm("inseamCm", "Leg length (inseam)", 65, 92)}
            <Slider label="Belly" value={Math.round(body.belly * 100)} min={0} max={100} format={(v) => `${v}%`} onChange={(v) => onBody({ ...body, belly: v / 100 })} />
          </Group>
        </div>
      )}
    </section>
  );
}
