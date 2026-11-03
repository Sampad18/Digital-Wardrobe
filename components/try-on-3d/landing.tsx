"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import ClothingRailHero from "@/components/ui/product-rail-gallery";
import { RAIL_DEMO_ITEMS } from "@/components/product-rail-gallery-demo";
import { DEFAULT_BODY } from "@/components/try-on/body";
import { WARDROBE } from "@/components/try-on/garments";
import { parseProfile } from "@/components/try-on/profile";

const TryOnScene = dynamic(() => import("./scene"), { ssr: false });

const STUDIO = "/try-on-3d/studio";
const ink = "#232C45";
const primary = "inline-flex items-center gap-2 rounded-full bg-[#232C45] px-5 py-2.5 text-sm font-medium text-white shadow-sm outline-none transition-[transform,box-shadow] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-[#232C45] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F3F1EC] active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-px [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-md motion-reduce:transition-none";
const quiet = "rounded-full px-4 py-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground";

/** Fades a block up once it scrolls into view; `delay` staggers siblings. */
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setShown(true); io.disconnect(); } }, { rootMargin: "0px 0px -12% 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:translate-y-0 motion-reduce:transition-opacity ${shown ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"} ${className}`}
      style={{ transitionDelay: shown ? `${delay}ms` : "0ms" }}
    >
      {children}
    </div>
  );
}

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia(motionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
function useReducedMotion() {
  return React.useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
}

/** A live mannequin on a turntable, cycling through tops. Mounts only once it's near the viewport. */
function LivePreview() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [near, setNear] = React.useState(false);
  const [body, setBody] = React.useState(DEFAULT_BODY);
  const tops = React.useMemo(() => WARDROBE.filter((g) => g.category === "top"), []);
  const bottom = WARDROBE.find((g) => g.category === "bottom") ?? null;
  const [i, setI] = React.useState(0);
  const reduced = useReducedMotion();

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    fetch("/api/profile")
      .then(async (res) => { const saved = res.ok ? parseProfile(await res.json()) : null; if (saved) setBody(saved.body); })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!near || reduced) return;
    const timer = window.setInterval(() => setI((n) => (n + 1) % tops.length), 3400);
    return () => window.clearInterval(timer);
  }, [near, reduced, tops.length]);

  const top = tops[i];
  const view = React.useMemo(() => ({ name: "front" as const, nonce: 0 }), []);
  return (
    <div ref={ref} className="relative">
      <div role="img" aria-label={`3D mannequin wearing ${top.name} and ${bottom?.name ?? "nothing"}`} className="aspect-[4/5] w-full overflow-hidden rounded-2xl bg-[#F3F1EC] ring-1 ring-black/5">
        {near && <TryOnScene body={body} top={top} bottom={bottom} view={view} spin={!reduced} />}
      </div>
      <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-xl bg-white/85 px-3.5 py-2.5 text-xs shadow-sm backdrop-blur">
        <span className="truncate font-medium">{top.name}</span>
        <span className="flex shrink-0 gap-1" aria-hidden="true">
          {tops.map((g, n) => <span key={g.id} className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${n === i ? "w-4 bg-[#232C45]" : "w-1.5 bg-black/20"}`} />)}
        </span>
      </div>
    </div>
  );
}

const STEPS = [
  { title: "Measure from two photos", body: "A front and a side photo plus your height give shoulders, chest, waist, hips and belly. Nothing leaves your device." },
  { title: "Add every piece you own", body: "Each item is stored as a small record and its fabric. One record re-fits any body, so nothing is re-made per outfit." },
  { title: "Mix outfits in 3D", body: "Swap a shirt, keep the shorts, turn the mannequin round. Every change is instant." },
];

export function TryOnLanding() {
  return (
    <main className="min-h-svh bg-[#F3F1EC] text-foreground" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-foreground">Wardrobe</Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Link href="/" className={`${quiet} hidden sm:inline-flex`}>The rail</Link>
          <Link href="/try-on" className={`${quiet} hidden sm:inline-flex`}>2D studio</Link>
          <Link href={STUDIO} className={primary}>Open fitting room</Link>
        </nav>
      </header>

      <section aria-label="Your wardrobe" className="mx-auto max-w-6xl px-2 sm:px-6">
        <ClothingRailHero
          items={RAIL_DEMO_ITEMS}
          hanger="none"
          magic
          autoplay
          eyebrow="3D try-on"
          heading="Open your wardrobe. Try everything on in 3D."
          caption="Every piece on the rail can go straight onto a mannequin built to your measurements."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href={STUDIO} className={primary}>
                Step into the fitting room
                <span aria-hidden="true">→</span>
              </Link>
              <a href="#how" className={quiet}>How it works</a>
            </div>
          }
        />
      </section>

      <section id="how" aria-labelledby="how-title" className="mx-auto grid max-w-6xl scroll-mt-6 items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:py-28">
        <div>
          <Reveal>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Dressed to your measurements</p>
            <h2 id="how-title" className="mt-3 max-w-[18ch] text-3xl font-semibold tracking-tight text-balance sm:text-4xl">The mannequin is you. The clothes are yours.</h2>
            <p className="mt-4 max-w-[52ch] leading-relaxed text-muted-foreground">
              Each garment is built from the same body measurements plus its fit, so a slim polo hugs and a relaxed tee hangs loose, on your shape rather than a model&apos;s.
            </p>
          </Reveal>
          <ol className="mt-10 grid gap-3">
            {STEPS.map((step, n) => (
              <Reveal key={step.title} delay={n * 70}>
                <li className="flex gap-4 rounded-xl bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.12)]">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold text-white tabular-nums" style={{ background: ink }}>{n + 1}</span>
                  <span>
                    <span className="block font-medium">{step.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{step.body}</span>
                  </span>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
        <Reveal delay={120}>
          <LivePreview />
        </Reveal>
      </section>

      <section aria-labelledby="cta-title" className="px-4 pb-16 sm:px-6">
        <Reveal className="mx-auto max-w-6xl">
          <div className="relative overflow-hidden rounded-2xl px-6 py-14 text-center text-white sm:py-16" style={{ background: `radial-gradient(ellipse 60% 80% at 50% 0%, #3A4672, ${ink} 70%)` }}>
            <h2 id="cta-title" className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">Your next outfit is already in the wardrobe.</h2>
            <p className="mx-auto mt-3 max-w-[46ch] text-sm leading-relaxed text-white/70">Pick a top, pick a bottom, turn it round. Soon the stylist will pick for you, with the weather in mind.</p>
            <Link href={STUDIO} className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#232C45] outline-none transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#232C45] active:scale-[0.97] [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-px motion-reduce:transition-none">
              Open the fitting room <span aria-hidden="true">→</span>
            </Link>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
