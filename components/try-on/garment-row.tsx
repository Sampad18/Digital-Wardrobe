import * as React from "react";
import type { Garment } from "./garments";

export function swatch(g: Garment): React.CSSProperties {
  if (g.pattern?.kind === "stripe") return { background: `repeating-linear-gradient(to bottom, ${g.color} 0 5px, ${g.pattern.color} 5px 7px)` };
  if (g.pattern?.kind === "print") return { background: `radial-gradient(circle at 30% 40%, ${g.pattern.ink} 0 1.5px, transparent 2px) 0 0 / 7px 7px, ${g.color}` };
  return { background: g.color };
}

export function GarmentRow({ g, selected, onSelect }: { g: Garment; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors duration-150 hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-foreground aria-pressed:bg-black/[0.06]"
    >
      <span aria-hidden="true" className="size-8 shrink-0 rounded-md ring-1 ring-black/10" style={swatch(g)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{g.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {g.source === "your photo" ? `From your photo · ${g.fit} fit` : g.source === "template" ? `Template · ${g.credit ?? "MakeHuman"}` : `Demo item · ${g.fit} fit`}
        </span>
      </span>
      <span aria-hidden="true" className={`size-2 rounded-full ${selected ? "bg-foreground" : "bg-transparent ring-1 ring-black/20"}`} />
    </button>
  );
}
