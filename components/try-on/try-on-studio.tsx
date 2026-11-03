"use client";

import * as React from "react";
import Link from "next/link";
import { DEFAULT_BODY, SKIN_TONES, VIEW_H, VIEW_W, skeleton, type BodyMeasurements } from "./body";
import { Avatar, SideAvatar } from "./avatar";
import { PhotoMeasure } from "./photo-measure";
import { GarmentDefs, GarmentShape, WARDROBE, type Garment } from "./garments";
import { parseProfile } from "./profile";
import { GarmentRow } from "./garment-row";

const SLIDERS: { key: keyof BodyMeasurements; label: string; min: number; max: number; unit: string }[] = [
  { key: "heightCm", label: "Height", min: 150, max: 200, unit: "cm" },
  { key: "shoulderCm", label: "Shoulders", min: 38, max: 58, unit: "cm" },
  { key: "chestCm", label: "Chest", min: 80, max: 130, unit: "cm" },
  { key: "waistCm", label: "Waist", min: 64, max: 120, unit: "cm" },
  { key: "hipCm", label: "Hips", min: 80, max: 125, unit: "cm" },
  { key: "inseamCm", label: "Inseam", min: 65, max: 92, unit: "cm" },
  { key: "armCm", label: "Arm length", min: 50, max: 68, unit: "cm" },
  { key: "build", label: "Build", min: 0, max: 100, unit: "%" },
  { key: "belly", label: "Belly", min: 0, max: 100, unit: "%" },
];
const PERCENT_KEYS = new Set<keyof BodyMeasurements>(["build", "belly"]);

export function TryOnStudio() {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [body, setBody] = React.useState(DEFAULT_BODY);
  const [topId, setTopId] = React.useState<string | null>("lee-abbey-polo");
  const [bottomId, setBottomId] = React.useState<string | null>("printed-shorts");
  const [recordId, setRecordId] = React.useState("lee-abbey-polo");
  const [view, setView] = React.useState<"front" | "side">("front");
  // DEFAULT_BODY already holds the owner's photo measurements, so the photo step starts closed.
  const [measuring, setMeasuring] = React.useState(false);
  const [measured, setMeasured] = React.useState(true);
  const [loaded, setLoaded] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSaved = React.useRef<string | null>(null);

  // Restore the saved profile once; a 404 just means nothing has been saved yet.
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then(async (res) => {
        const saved = res.ok ? parseProfile(await res.json()) : null;
        if (cancelled) return;
        if (saved) {
          setBody(saved.body);
          setTopId(saved.outfit.topId);
          setBottomId(saved.outfit.bottomId);
          setMeasured(saved.measured);
          lastSaved.current = JSON.stringify({ body: saved.body, outfit: saved.outfit, measured: saved.measured });
          setSaveState("saved");
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Autosave shortly after the last change, so dragging a slider sends one save, not dozens.
  const snapshot = JSON.stringify({ body, outfit: { topId, bottomId }, measured });
  React.useEffect(() => {
    if (!loaded || snapshot === lastSaved.current) return;
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: snapshot });
        if (!res.ok) throw new Error(String(res.status));
        lastSaved.current = snapshot;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [snapshot, loaded]);

  const k = React.useMemo(() => skeleton(body), [body]);
  const worn = [bottomId, topId].map((id) => WARDROBE.find((g) => g.id === id)).filter((g): g is Garment => !!g);
  const record = WARDROBE.find((g) => g.id === recordId) ?? WARDROBE[0];
  const tops = WARDROBE.filter((g) => g.category === "top");
  const bottoms = WARDROBE.filter((g) => g.category === "bottom");

  const pick = (g: Garment) => {
    const setter = g.category === "top" ? setTopId : setBottomId;
    setter((current) => (current === g.id ? null : g.id));
    setRecordId(g.id);
  };

  return (
    <main className="min-h-svh bg-[#F3F1EC] text-foreground selection:bg-[#232C45] selection:text-white" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:py-10">
        <section aria-label="Avatar" className="flex flex-col items-center lg:sticky lg:top-10 lg:self-start">
          <div className="flex w-full items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">Try-on</h1>
              <span aria-live="polite" className={`text-xs ${saveState === "error" ? "text-[#9B2C2C]" : "text-muted-foreground"}`}>
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn't save. Changes will be lost on reload." : ""}
              </span>
            </div>
            <Link href="/" className="text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-foreground">Back to the rail</Link>
          </div>
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            role="img"
            aria-label={`Avatar wearing ${worn.map((g) => g.name).join(" and ") || "nothing selected"}`}
            className="mt-4 h-[min(62svh,760px)] w-auto max-w-full lg:h-[min(78svh,760px)]"
          >
            {view === "front" ? (
              <>
                <GarmentDefs items={worn} uid={uid} />
                <Avatar k={k} skin={body.skin} uid={uid}>
                  {worn.map((g) => <GarmentShape key={g.id} g={g} k={k} uid={uid} />)}
                </Avatar>
              </>
            ) : (
              <SideAvatar k={k} skin={body.skin} uid={uid} />
            )}
          </svg>
          <div role="group" aria-label="View" className="mt-1 inline-flex rounded-full bg-black/[0.05] p-1 text-xs font-medium">
            {(["front", "side"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className="rounded-full px-3.5 py-1.5 capitalize text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground aria-pressed:bg-white aria-pressed:text-foreground aria-pressed:shadow-sm">
                {v}
              </button>
            ))}
          </div>
          <p className="mt-2 max-w-[46ch] text-center text-xs leading-relaxed text-muted-foreground">
            {measured ? "Shaped from your photos and height." : "Estimated proportions. Add your photos for a closer fit."}
          </p>
        </section>

        <aside className="flex flex-col gap-6">
          <section aria-labelledby={`${uid}-measure`} className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`${uid}-measure`} className="text-sm font-semibold">{measured ? "Measured from your photos" : "Measure from your photos"}</h2>
              {!measuring && (
                <button type="button" onClick={() => setMeasuring(true)} className="text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-foreground">Measure again</button>
              )}
            </div>
            {measuring ? (
              <div className="mt-2">
                <PhotoMeasure
                  heightCm={body.heightCm}
                  onApply={(m) => { setBody((b) => ({ ...b, ...m })); setMeasured(true); setMeasuring(false); }}
                />
                {!measured && (
                  <button type="button" onClick={() => setMeasuring(false)} className="mt-3 text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-foreground">Skip and use the estimate</button>
                )}
              </div>
            ) : (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {measured ? "Your avatar uses your photo measurements at 172 cm. Hips are estimated, since loose boxers inflated the photo reading. Fine-tune anything under Body." : "Using an estimate. Add your photos for a closer fit."}
              </p>
            )}
          </section>

          <section aria-labelledby={`${uid}-tops`} className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
            <h2 id={`${uid}-tops`} className="px-2.5 pb-1 pt-1 text-sm font-semibold">Tops</h2>
            {tops.map((g) => <GarmentRow key={g.id} g={g} selected={topId === g.id} onSelect={() => pick(g)} />)}
            <h2 className="px-2.5 pb-1 pt-4 text-sm font-semibold">Bottoms</h2>
            {bottoms.map((g) => <GarmentRow key={g.id} g={g} selected={bottomId === g.id} onSelect={() => pick(g)} />)}
          </section>

          <section aria-labelledby={`${uid}-body`} className="rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
            <div className="flex items-baseline justify-between">
              <h2 id={`${uid}-body`} className="text-sm font-semibold">Body</h2>
              <button type="button" onClick={() => setBody(DEFAULT_BODY)} className="text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-foreground">Reset to my measurements</button>
            </div>
            <div className="mt-4 flex flex-col gap-3.5">
              {SLIDERS.map(({ key, label, min, max, unit }) => {
                const raw = body[key] as number;
                const value = PERCENT_KEYS.has(key) ? Math.round(raw * 100) : raw;
                return (
                  <label key={key} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">
                    <span>{label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{value} {unit}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      value={value}
                      onChange={(event) => {
                        const n = Number(event.target.value);
                        setBody((b) => ({ ...b, [key]: PERCENT_KEYS.has(key) ? n / 100 : n }));
                      }}
                      className="col-span-2 h-1.5 w-full cursor-pointer accent-[#232C45]"
                    />
                  </label>
                );
              })}
            </div>
            <fieldset className="mt-5">
              <legend className="text-sm">Skin tone</legend>
              <div className="mt-2 flex gap-2">
                {SKIN_TONES.map((tone) => (
                  <button
                    key={tone}
                    type="button"
                    aria-label={`Skin tone ${tone}`}
                    aria-pressed={body.skin === tone}
                    onClick={() => setBody((b) => ({ ...b, skin: tone }))}
                    className="size-7 rounded-full outline-none ring-offset-2 ring-offset-white transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-foreground aria-pressed:ring-2 aria-pressed:ring-[#232C45]"
                    style={{ background: tone }}
                  />
                ))}
              </div>
            </fieldset>
          </section>

          <section aria-labelledby={`${uid}-record`} className="rounded-xl bg-[#1B2030] p-5 text-[#E8EAF0] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)]">
            <h2 id={`${uid}-record`} className="text-sm font-semibold">{record.name} as code</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#A9AFC2]">This record is all the app stores. The same record redraws to fit any body.</p>
            <pre className="mt-3 max-h-72 overflow-auto text-[11.5px] leading-relaxed text-[#D5D9E6] [scrollbar-color:#3A4158_transparent] selection:bg-[#3A4158]">
              <code>{JSON.stringify(record, null, 2)}</code>
            </pre>
          </section>
        </aside>
      </div>
    </main>
  );
}
