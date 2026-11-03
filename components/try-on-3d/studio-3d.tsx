"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { DEFAULT_BODY } from "@/components/try-on/body";
import { WARDROBE } from "@/components/try-on/garments";
import { parseProfile } from "@/components/try-on/profile";
import { GarmentRow } from "@/components/try-on/garment-row";
import type { View } from "./scene";

// WebGL only exists in the browser, so the scene never renders on the server.
const TryOnScene = dynamic(() => import("./scene"), {
  ssr: false,
  loading: () => <div className="grid size-full place-items-center text-sm text-muted-foreground">Building your mannequin…</div>,
});

const card = "rounded-xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.12)]";
const pill = "rounded-full px-3.5 py-1.5 capitalize text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground aria-pressed:bg-white aria-pressed:text-foreground aria-pressed:shadow-sm";

export function TryOnStudio3D() {
  const [body, setBody] = React.useState(DEFAULT_BODY);
  const [topId, setTopId] = React.useState<string | null>("lee-abbey-polo");
  const [bottomId, setBottomId] = React.useState<string | null>("printed-shorts");
  const [view, setView] = React.useState<{ name: View; nonce: number }>({ name: "front", nonce: 0 });
  const [spin, setSpin] = React.useState(false);

  // The body comes from the 2D studio's saved profile; the outfit here starts as the polo and shorts.
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then(async (res) => {
        const saved = res.ok ? parseProfile(await res.json()) : null;
        if (!cancelled && saved) setBody(saved.body);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const top = WARDROBE.find((g) => g.id === topId) ?? null;
  const bottom = WARDROBE.find((g) => g.id === bottomId) ?? null;
  const pick = (id: string, category: "top" | "bottom") => {
    const setter = category === "top" ? setTopId : setBottomId;
    setter((current) => (current === id ? null : id));
  };

  return (
    <main className="min-h-svh bg-[#F3F1EC] text-foreground" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-10">
        <section aria-label="3D mannequin" className="flex flex-col lg:sticky lg:top-10 lg:self-start">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-2xl font-semibold tracking-tight">Try-on 3D</h1>
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
            <TryOnScene body={body} top={top} bottom={bottom} view={view} spin={spin} />
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
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">Drag to turn, scroll or pinch to zoom.</p>
        </section>

        <aside className="flex flex-col gap-6">
          <section aria-labelledby="tops-3d" className={`${card} p-3`}>
            <h2 id="tops-3d" className="px-2.5 pb-1 pt-1 text-sm font-semibold">Tops</h2>
            {WARDROBE.filter((g) => g.category === "top").map((g) => <GarmentRow key={g.id} g={g} selected={topId === g.id} onSelect={() => pick(g.id, "top")} />)}
            <h2 className="px-2.5 pb-1 pt-4 text-sm font-semibold">Bottoms</h2>
            {WARDROBE.filter((g) => g.category === "bottom").map((g) => <GarmentRow key={g.id} g={g} selected={bottomId === g.id} onSelect={() => pick(g.id, "bottom")} />)}
          </section>

          <section aria-labelledby="body-3d" className={`${card} p-5`}>
            <h2 id="body-3d" className="text-sm font-semibold">Your body</h2>
            <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 text-xs">
              {([["Height", body.heightCm], ["Shoulders", body.shoulderCm], ["Chest", body.chestCm], ["Waist", body.waistCm], ["Hips", body.hipCm], ["Inseam", body.inseamCm]] as const).map(([label, v]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular-nums font-medium">{v} cm</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Each garment is built from the same body sections plus its fit ease, so it re-fits whenever these change. Adjust them in the{" "}
              <Link href="/try-on" className="underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground">2D studio</Link>.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
