"use client";

import * as React from "react";
import { MeasureError, loadDetector, measure, type Measured, type Overlay } from "./measure";

type Photo = { src: string; img: HTMLImageElement; name: string };
type Status = { kind: "idle" } | { kind: "working"; text: string } | { kind: "error"; text: string } | { kind: "done"; result: Measured };

function loadPhoto(file: File): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ src, img, name: file.name });
    img.onerror = () => reject(new MeasureError("That file couldn't be opened as an image. Try a JPG or PNG."));
    img.src = src;
  });
}

function Slot({ label, hint, photo, onPick, required }: { label: string; hint: string; photo: Photo | null; onPick: (file: File) => void; required?: boolean }) {
  return (
    <label className="group relative flex aspect-[3/4] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-black/20 bg-[#F7F6F3] text-center outline-none transition-colors duration-150 hover:border-black/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-foreground">
      <input
        type="file"
        accept="image/*"
        aria-label={`${label} photo`}
        className="sr-only"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) onPick(file); event.target.value = ""; }}
      />
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.src} alt={`${label} photo`} className="absolute inset-0 size-full object-cover" />
      ) : (
        <>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4m0 0-4 4m4-4 4 4" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
          <span className="mt-2 text-sm font-medium">{label}{required ? "" : " (optional)"}</span>
          <span className="mt-0.5 px-3 text-[11px] leading-snug text-muted-foreground">{hint}</span>
        </>
      )}
      {photo && <span className="absolute inset-x-0 bottom-0 bg-black/55 py-1 text-[11px] font-medium text-white">Replace {label.toLowerCase()}</span>}
    </label>
  );
}

function Traced({ o, title }: { o: Overlay; title: string }) {
  return (
    <figure className="flex-1">
      <div className="relative overflow-hidden rounded-md bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={o.src} alt={title} className="block w-full" />
        <svg viewBox={`0 0 ${o.w} ${o.h}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          {o.lines.map((l) => (
            <g key={l.label}>
              <line x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} stroke="#FFD24A" strokeWidth={o.w / 160} />
              {[l.x1, l.x2].map((x) => <circle key={x} cx={x} cy={l.y} r={o.w / 110} fill="#FFD24A" />)}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
        {o.lines.map((l) => <span key={l.label} className="block">{l.label}</span>)}
      </figcaption>
    </figure>
  );
}

export function PhotoMeasure({ heightCm, onApply }: { heightCm: number; onApply: (m: Measured["body"]) => void }) {
  const [front, setFront] = React.useState<Photo | null>(null);
  const [side, setSide] = React.useState<Photo | null>(null);
  const [height, setHeight] = React.useState(String(heightCm));
  const [status, setStatus] = React.useState<Status>({ kind: "idle" });
  const id = React.useId();

  const pick = (setter: (p: Photo) => void) => async (file: File) => {
    try { setter(await loadPhoto(file)); setStatus({ kind: "idle" }); } catch (e) { setStatus({ kind: "error", text: (e as Error).message }); }
  };

  const h = Number(height);
  const heightOk = Number.isFinite(h) && h >= 140 && h <= 210;

  const run = async () => {
    if (!front || !heightOk) return;
    try {
      setStatus({ kind: "working", text: "Loading body detection. The first time takes a few seconds…" });
      await loadDetector();
      setStatus({ kind: "working", text: side ? "Reading both photos…" : "Reading your photo…" });
      const result = await measure(front, side, h);
      setStatus({ kind: "done", result });
    } catch (e) {
      setStatus({ kind: "error", text: e instanceof MeasureError ? e.message : "Body detection couldn't load. Check your internet connection and try again." });
    }
  };

  return (
    <div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Stand straight in fitted clothes with your arms slightly away from your body, head to toe in frame. For the side photo, turn 90° with your arms relaxed. Photos stay on this device.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Slot label="Front" hint="Facing the camera" photo={front} onPick={pick(setFront)} required />
        <Slot label="Side" hint="Turned 90°, shows your stomach" photo={side} onPick={pick(setSide)} />
      </div>
      <div className="mt-3 flex items-end gap-2.5">
        <label htmlFor={`${id}-h`} className="flex-1 text-sm">
          Your height
          <span className="mt-1 flex items-center rounded-md border border-black/15 bg-white focus-within:ring-2 focus-within:ring-foreground">
            <input
              id={`${id}-h`}
              inputMode="numeric"
              value={height}
              onChange={(e) => setHeight(e.target.value.replace(/[^0-9.]/g, ""))}
              aria-invalid={!heightOk}
              className="w-full bg-transparent px-2.5 py-2 text-sm tabular-nums outline-none"
            />
            <span className="pr-2.5 text-xs text-muted-foreground">cm</span>
          </span>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={!front || !heightOk || status.kind === "working"}
          className="h-[38px] rounded-md bg-[#232C45] px-4 text-sm font-medium text-white outline-none transition-[background-color,opacity] duration-150 hover:bg-[#1A2136] focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {status.kind === "working" ? "Measuring…" : "Measure me"}
        </button>
      </div>
      {!heightOk && <p className="mt-1.5 text-xs text-[#9B2C2C]">Enter a height between 140 and 210 cm. A photo can&apos;t show scale on its own.</p>}

      <div aria-live="polite" className="mt-3 text-xs">
        {status.kind === "working" && <p className="text-muted-foreground">{status.text}</p>}
        {status.kind === "error" && <p className="rounded-md bg-[#FBEAEA] px-3 py-2 leading-relaxed text-[#9B2C2C]">{status.text}</p>}
      </div>

      {status.kind === "done" && (
        <div className="mt-1">
          <div className="flex gap-2.5">
            <Traced o={status.result.front} title="Front photo with measurement lines" />
            {status.result.side && <Traced o={status.result.side} title="Side photo with measurement lines" />}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs tabular-nums">
            {([
              ["Shoulders", `${status.result.body.shoulderCm} cm`],
              ["Chest", `${status.result.body.chestCm} cm`],
              ["Waist", `${status.result.body.waistCm} cm`],
              ["Hips", `${status.result.body.hipCm} cm`],
              ["Inseam", `${status.result.body.inseamCm} cm`],
              ["Arm", `${status.result.body.armCm} cm`],
              ["Belly", `${Math.round(status.result.body.belly * 100)}%`],
            ] as const).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-black/[0.06] py-1"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {status.result.notes.length > 0 && (
            <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              {status.result.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <button
            type="button"
            onClick={() => onApply(status.result.body)}
            className="mt-3 w-full rounded-md bg-[#232C45] py-2 text-sm font-medium text-white outline-none transition-colors duration-150 hover:bg-[#1A2136] focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2"
          >
            Apply to my avatar
          </button>
        </div>
      )}
    </div>
  );
}
