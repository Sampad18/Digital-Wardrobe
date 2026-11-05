import type { Garment } from "@/components/try-on/garments";
import LIBRARY from "./template-garments.json";

/**
 * MakeHuman garment templates to try on in 3D, beyond the wardrobe's own items.
 * Each `model` is a file built by tools/mpfb (public/models/garments/<model>.glb).
 * The 2D-only fields (type, fit, length, trim) are best guesses; the 3D fitting
 * room only uses `model`, `color`, `pattern` and `covers`.
 */
const template = (g: Omit<Garment, "source" | "details" | "trim"> & { trim?: string; details?: string[] }): Garment => ({
  trim: g.color,
  details: [],
  source: "template",
  ...g,
});

const FIRST: Garment[] = [
  // Tops
  template({ id: "t-oxford-shirt", name: "Button-down shirt · Sky", category: "top", type: "long-sleeve", fit: "regular", sleeve: "long", length: "low-hip", color: "#A9C7E2", model: "shirt", credit: "Elvaerwyn, CC-BY" }),
  template({ id: "t-hoodie", name: "Hooded sweat jacket · Heather", category: "top", type: "long-sleeve", fit: "relaxed", sleeve: "long", length: "low-hip", color: "#9EA3A8", model: "hoodie", credit: "Elvaerwyn, CC-BY" }),
  template({ id: "t-tank", name: "Tank shirt · White", category: "top", type: "tee", fit: "regular", length: "hip", color: "#EDEBE6", model: "tank", credit: "Elvaerwyn, CC-BY" }),
  template({ id: "t-knit", name: "Knitted sweater · Oat", category: "top", type: "long-sleeve", fit: "relaxed", sleeve: "long", length: "hip", color: "#CDBFA5", model: "knit", credit: "Mindfront, CC-BY" }),
  template({ id: "t-vneck", name: "V-neck top · Rose", category: "top", type: "tee", fit: "slim", length: "hip", color: "#D9A3A6", model: "vneck", credit: "punkduck, CC-BY" }),
  // Dresses: worn instead of a top and bottom
  template({ id: "t-shift-dress", name: "Shift dress · Black", category: "top", covers: "full", type: "tee", fit: "regular", length: "above-knee", color: "#2B2B30", model: "shiftdress", credit: "Margaret Toigo, CC0" }),
  template({ id: "t-halter-dress", name: "Halter dress · Emerald", category: "top", covers: "full", type: "tee", fit: "regular", length: "above-knee", color: "#2F6B52", model: "halterdress", credit: "Margaret Toigo, CC0" }),
  // Bottoms
  template({ id: "t-classic-jeans", name: "Classic jeans · Indigo", category: "bottom", type: "shorts", fit: "regular", length: "above-knee", color: "#3C4C6E", model: "jeans", credit: "punkduck, CC-BY" }),
  template({ id: "t-trousers", name: "Trousers · Charcoal", category: "bottom", type: "shorts", fit: "regular", length: "above-knee", color: "#4A4C52", model: "trousers", credit: "Elvaerwyn, CC-BY" }),
  template({ id: "t-cargo", name: "Cargo pants · Khaki", category: "bottom", type: "shorts", fit: "relaxed", length: "above-knee", color: "#8C8461", model: "cargo", credit: "Cortu, CC0" }),
  template({ id: "t-short-trousers", name: "Short trousers · Stone", category: "bottom", type: "shorts", fit: "regular", length: "above-knee", color: "#B8AE98", model: "shorttrousers", credit: "Elvaerwyn, CC-BY" }),
  template({ id: "t-pencil-skirt", name: "Pencil skirt · Navy", category: "bottom", type: "shorts", fit: "slim", length: "above-knee", color: "#2C3550", model: "pencilskirt", credit: "Elvaerwyn, CC-BY" }),
  template({ id: "t-tight-jeans", name: "Tight jeans · Washed blue", category: "bottom", type: "shorts", fit: "slim", length: "above-knee", color: "#6C84A8", model: "tightjeans", credit: "punkduck, CC-BY" }),
];

type Kind = "top" | "bottom" | "skirt" | "dress" | "outfit";
type Entry = { key: string; asset: string; kind: Kind; name: string; fit: Garment["fit"]; color: string; credit: string };

/** The rest of the downloaded packs (template-garments.json, built by tools/mpfb/build_garments.sh). */
const kindOf = new Map<string, Kind>();
const MORE: Garment[] = (LIBRARY as Entry[]).map((e) => {
  kindOf.set(`t-${e.key}`, e.kind);
  const full = e.kind === "dress" || e.kind === "outfit";
  return template({
    id: `t-${e.key}`,
    name: e.name,
    category: e.kind === "top" || full ? "top" : "bottom",
    ...(full ? { covers: "full" as const } : {}),
    type: e.kind === "top" ? "tee" : "shorts",
    fit: e.fit,
    length: e.kind === "top" ? "hip" : "above-knee",
    color: e.color,
    model: e.key,
    credit: e.credit,
  });
});
for (const g of FIRST) kindOf.set(g.id, g.covers ? "dress" : g.model?.includes("skirt") ? "skirt" : g.category);

export const TEMPLATES: Garment[] = [...FIRST, ...MORE];

/** Templates grouped for the fitting room's list. */
export const TEMPLATE_GROUPS: { title: string; items: Garment[] }[] = (
  [
    ["Tops", "top"],
    ["Dresses", "dress"],
    ["Outfits and suits", "outfit"],
    ["Trousers and shorts", "bottom"],
    ["Skirts", "skirt"],
  ] as const
).map(([title, kind]) => ({ title, items: TEMPLATES.filter((g) => kindOf.get(g.id) === kind) }));
