"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { DEFAULT_BODY } from "@/components/try-on/body";
import { WARDROBE } from "@/components/try-on/garments";
import { TEMPLATES, TEMPLATE_GROUPS } from "./templates";
import { parseProfile } from "@/components/try-on/profile";
import { GarmentRow } from "@/components/try-on/garment-row";
import type { View } from "./scene";
import { DEFAULT_APPEARANCE } from "./appearance";
import { AppearanceEditor, type EditorTab } from "./appearance-editor";

// WebGL only exists in the browser, so the scene never renders on the server.
const TryOnScene = dynamic(() => import("./scene"), {
  ssr: false,
  loading: () => <div className="grid size-full place-items-center text-sm text-muted-foreground">Building your mannequin…</div>,
});

const card = "rounded-xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.12)]";
const pill = "rounded-full px-3.5 py-1.5 capitalize text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground aria-pressed:bg-white aria-pressed:text-foreground aria-pressed:shadow-sm";

/** Your wardrobe first, then MakeHuman templates to try on. */
const ITEMS = [...WARDROBE, ...TEMPLATES];
const SECTIONS = [
  { title: "Your tops", items: WARDROBE.filter((g) => g.category === "top") },
  { title: "Your bottoms", items: WARDROBE.filter((g) => g.category === "bottom") },
];

export function TryOnStudio3D() {
  const [body, setBody] = React.useState(DEFAULT_BODY);
  const [topId, setTopId] = React.useState<string | null>("lee-abbey-polo");
  const [bottomId, setBottomId] = React.useState<string | null>("printed-shorts");
  const [view, setView] = React.useState<{ name: View; nonce: number }>({ name: "front", nonce: 0 });
  const [spin, setSpin] = React.useState(false);
  // Clothes settle onto the body under gravity (physics drape) unless switched off.
  const [drape, setDrape] = React.useState(true);
  const [appearance, setAppearance] = React.useState(DEFAULT_APPEARANCE);
  const [tab, setTab] = React.useState<EditorTab>("body");
  const [measured, setMeasured] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  // The body as last saved, so "Reset to my measurements" undoes slider changes made here.
  const savedBody = React.useRef(DEFAULT_BODY);
  const lastSaved = React.useRef<string | null>(null);

  // Body, appearance and measured flag come from the shared profile; the outfit here starts as the polo and shorts.
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then(async (res) => {
        const saved = res.ok ? parseProfile(await res.json()) : null;
        if (cancelled || !saved) return;
        savedBody.current = saved.body;
        setBody(saved.body);
        setMeasured(saved.measured);
        if (saved.appearance) setAppearance(saved.appearance);
        lastSaved.current = JSON.stringify({ body: saved.body, appearance: saved.appearance ?? DEFAULT_APPEARANCE });
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Autosave shortly after the last change, like the 2D studio. The saved outfit stays the 2D studio's.
  const snapshot = JSON.stringify({ body, appearance });
  React.useEffect(() => {
    if (!loaded || snapshot === lastSaved.current) return;
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const current = await fetch("/api/profile").then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const res = await fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outfit: current?.outfit ?? { topId, bottomId }, measured, ...JSON.parse(snapshot) }),
        });
        if (!res.ok) throw new Error(String(res.status));
        lastSaved.current = snapshot;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [snapshot, loaded, measured, topId, bottomId]);

  const top = ITEMS.find((g) => g.id === topId) ?? null;
  const bottom = ITEMS.find((g) => g.id === bottomId) ?? null;
  // A dress replaces both a top and a bottom; a bottom put on over a dress takes it off.
  const pick = (id: string, category: "top" | "bottom") => {
    const item = ITEMS.find((g) => g.id === id);
    if (item?.covers === "full") setBottomId(null);
    if (category === "bottom") setTopId((current) => (ITEMS.find((g) => g.id === current)?.covers === "full" ? null : current));
    const setter = category === "top" ? setTopId : setBottomId;
    setter((current) => (current === id ? null : id));
  };

  return (
    <main className="min-h-svh bg-[#F3F1EC] text-foreground" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-10">
        <section aria-label="3D mannequin" className="flex flex-col lg:sticky lg:top-10 lg:self-start">
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">Try-on 3D</h1>
              <span aria-live="polite" className={`text-xs ${saveState === "error" ? "text-[#9B2C2C]" : "text-muted-foreground"}`}>
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Couldn't save. Changes will be lost on reload." : ""}
              </span>
            </div>
            <nav aria-label="Try-on" className="flex gap-4 text-sm text-muted-foreground">
              <Link href="/try-on-3d" className="underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-foreground">Wardrobe</Link>
              <Link href="/try-on" className="underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-foreground">2D studio</Link>
            </nav>
          </div>
          <div
            role="img"
            aria-label={`3D mannequin wearing ${[top?.name, bottom?.name].filter(Boolean).join(" and ") || "nothing selected"}. Drag to turn it.`}
            className="mt-4 h-[min(64svh,720px)] w-full touch-none overflow-hidden rounded-xl lg:h-[min(78svh,760px)]"
          >
            <TryOnScene body={body} top={top} bottom={bottom} view={view} spin={spin} appearance={appearance} focus={tab === "face" ? "face" : "body"} drape={drape} />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs font-medium">
            <div role="group" aria-label="View" className="inline-flex rounded-full bg-black/[0.05] p-1">
              {(["front", "side", "back"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view.name === v && !spin} onClick={() => { setSpin(false); setView((cur) => ({ name: v, nonce: cur.nonce + 1 })); }} className={pill}>
                  {v}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-full bg-black/[0.05] p-1">
              <button type="button" aria-pressed={spin} onClick={() => setSpin((s) => !s)} className={pill}>Turntable</button>
              <button type="button" aria-pressed={drape} onClick={() => setDrape((d) => !d)} title="Let the top fall onto the body with cloth physics" className={pill}>Physics drape</button>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">Drag to turn, scroll or pinch to zoom.</p>
        </section>

        <aside className="flex flex-col gap-6">
          <section aria-labelledby="tops-3d" className={`${card} p-3`}>
            {SECTIONS.map(({ title, items }, n) => (
              <React.Fragment key={title}>
                <h2 id={n === 0 ? "tops-3d" : undefined} className={`px-2.5 pb-1 text-sm font-semibold ${n === 0 ? "pt-1" : "pt-4"}`}>{title}</h2>
                {items.map((g) => {
                  const slot = g.category;
                  return <GarmentRow key={g.id} g={g} selected={(slot === "top" ? topId : bottomId) === g.id} onSelect={() => pick(g.id, slot)} />;
                })}
              </React.Fragment>
            ))}
            <h2 className="px-2.5 pb-1 pt-5 text-sm font-semibold">Templates</h2>
            {TEMPLATE_GROUPS.map(({ title, items }) => (
              <details key={title} className="group" open={items.some((g) => g.id === topId || g.id === bottomId) || undefined}>
                <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg px-2.5 py-2 text-sm hover:bg-black/[0.04] [&::-webkit-details-marker]:hidden">
                  <span>{title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {items.length}
                    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 transition-transform duration-200 ease-out group-open:rotate-180"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </summary>
                {items.map((g) => (
                  <GarmentRow key={g.id} g={g} selected={(g.category === "top" ? topId : bottomId) === g.id} onSelect={() => pick(g.id, g.category)} />
                ))}
              </details>
            ))}
          </section>

          <AppearanceEditor
            tab={tab}
            onTab={setTab}
            appearance={appearance}
            onAppearance={setAppearance}
            body={body}
            onBody={setBody}
            onResetBody={() => setBody(savedBody.current)}
          />
        </aside>
      </div>
    </main>
  );
}
