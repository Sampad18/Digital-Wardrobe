import * as THREE from "three";
import type { Garment } from "@/components/try-on/garments";

/**
 * Fabric textures drawn on a canvas from the garment record. Garment UVs are
 * in metres, so `repeat` = 100 / tile size in cm puts every print at true scale.
 */

function tile(wCm: number, hCm: number, pxPerCm: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(wCm * pxPerCm);
  canvas.height = Math.round(hCm * pxPerCm);
  const ctx = canvas.getContext("2d")!;
  draw(ctx, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(100 / wCm, 100 / hCm);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Piqué / jersey: the base colour with a fine knit grain so flat colour reads as cloth. */
function knit(color: string) {
  return tile(1.2, 1.2, 80, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    const step = w / 6;
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        ctx.fillStyle = (x + y) % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.09)";
        ctx.beginPath();
        ctx.ellipse((x + 0.5) * step, (y + 0.5) * step, step * 0.38, step * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

function stripe(color: string, ink: string, widthCm: number, gapCm: number) {
  const h = widthCm + gapCm;
  return tile(2, h, 40, (ctx, w, hp) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, hp);
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, w, (widthCm / h) * hp);
  });
}

/** The printed shorts: wave lines and little type blocks, as in the 2D pattern. */
function print(color: string, ink: string) {
  return tile(12, 8, 40, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.scale(w / 44, h / 30);
    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    const wave = (y: number, width: number, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(6, y - 5, 12, y + 5, 18, y);
      ctx.bezierCurveTo(24, y - 5, 30, y - 5, 36, y);
      ctx.bezierCurveTo(40, y + 3, 42, y + 3, 44, y);
      ctx.stroke();
    };
    wave(8, 2.2, 0.85);
    wave(23, 1.4, 0.6);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = ink;
    for (const [x, y, rw, rh] of [[4, 13, 3, 4], [9, 13, 2, 4], [13, 13, 3, 4], [26, 14, 2, 3.5], [30, 14, 3, 3.5]]) ctx.fillRect(x, y, rw, rh);
    ctx.restore();
  });
}

export function fabricFor(g: Garment): THREE.Texture {
  if (g.pattern?.kind === "stripe") return stripe(g.color, g.pattern.color, g.pattern.widthCm, g.pattern.gapCm);
  if (g.pattern?.kind === "print") return print(g.color, g.pattern.ink);
  return knit(g.color);
}

/** Ribbed trim (collars, cuffs, waistbands): vertical ribs in the trim colour. */
export function ribFor(color: string) {
  return tile(0.6, 1, 80, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    ctx.fillRect(0, 0, w * 0.35, h);
  });
}
