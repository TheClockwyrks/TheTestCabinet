// Spectra — provided art (specs/assets.md).
//
// The ship and the three drones are pre-drawn 64x64 pixel-art sprites, seeded
// under assets/. We render *from* that art; the only thing derived at runtime is
// the BAND each sprite is shown in. Each sprite ships in one representative
// band-state, and the other state is the same silhouette re-tinted to the other
// band's color — the ring/diamond glyph itself is drawn in code on top so the
// band always reads correctly (never a cyan diamond or a magenta ring).
//
// All URLs are imported through Vite, so they resolve page-relative under any
// base path (the build sets `base: "./"`), exactly as specs/assets.md requires.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import { CYAN, MAGENTA, type Band } from "./constants";

import fighterUrl from "./assets/fighter.png";
import shardUrl from "./assets/shard.png";
import fluxUrl from "./assets/flux.png";
import prismUrl from "./assets/prism.png";
import droneBurst from "./assets/drone-burst.json";

const BAND_RGB: Record<Band, [number, number, number]> = {
  [CYAN]: [52, 226, 255], // #34e2ff
  [MAGENTA]: [255, 78, 199], // #ff4ec7
};

type Family = "none" | "cyan" | "magenta";

export interface Assets {
  // Ship and drone sprites, per band-state (64x64 canvases).
  fighter: Record<Band, HTMLCanvasElement>;
  shard: Record<Band, HTMLCanvasElement>;
  fluxHeld: Record<Band, HTMLCanvasElement>;
  fluxShimmer: HTMLCanvasElement; // both bands at once (the provided art)
  prismFull: Record<Band, HTMLCanvasElement>; // keyed by SHELL band
  prismCore: Record<Band, HTMLCanvasElement>; // keyed by CORE band
  burst: ParticleSystem;
}

// Classify a source pixel into a band family (or neutral hull/white).
function classify(r: number, g: number, b: number): Family {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 8) return "none";
  const sat = (max - min) / max;
  if (sat < 0.28) return "none"; // white hull, grey shading, dark disc
  // Cyan reads as high green+blue, low red; magenta as high red+blue, low green.
  if (b > 60 && g >= r && b >= r) return "cyan";
  if (r > 60 && r >= g && b >= g) return "magenta";
  return "none";
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Spectra: failed to load ${url}`));
    img.src = url;
  });
}

function toImageData(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);
  ctx.drawImage(img, 0, 0, 64, 64);
  return ctx.getImageData(0, 0, 64, 64);
}

function makeCanvas(data: ImageData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  c.getContext("2d")!.putImageData(data, 0, 0);
  return c;
}

// Recolor a source: every band-carrying pixel is mapped through `mapFamily`,
// which either returns a target band color (tinted to the pixel's brightness),
// `"keep"` to preserve the original pixel, or `"drop"` to erase it. Neutral
// (hull/white) pixels are always kept.
function recolor(
  src: ImageData,
  mapFamily: (fam: Family) => Band | "keep" | "drop",
  keepNeutralWithin?: number, // if set, drop neutral pixels beyond this radius from center
): HTMLCanvasElement {
  const out = new ImageData(64, 64);
  for (let i = 0; i < src.data.length; i += 4) {
    const r = src.data[i]!;
    const g = src.data[i + 1]!;
    const b = src.data[i + 2]!;
    const a = src.data[i + 3]!;
    if (a === 0) continue;
    const fam = classify(r, g, b);
    let target: Band | "keep" | "drop";
    if (fam === "none") {
      target = "keep";
      if (keepNeutralWithin !== undefined) {
        const px = (i / 4) % 64;
        const py = Math.floor(i / 4 / 64);
        if (Math.hypot(px - 32, py - 32) > keepNeutralWithin) target = "drop";
      }
    } else {
      target = mapFamily(fam);
    }
    if (target === "drop") continue;
    if (target === "keep") {
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
    } else {
      const value = Math.max(r, g, b) / 255;
      const [br, bg, bb] = BAND_RGB[target];
      out.data[i] = Math.round(br * value);
      out.data[i + 1] = Math.round(bg * value);
      out.data[i + 2] = Math.round(bb * value);
      out.data[i + 3] = a;
    }
  }
  return makeCanvas(out);
}

// A single-band collapse: every band-carrying pixel becomes `band`.
function singleBand(src: ImageData, band: Band): HTMLCanvasElement {
  return recolor(src, () => band);
}

export async function loadAssets(): Promise<Assets> {
  const [fighterImg, shardImg, fluxImg, prismImg] = await Promise.all([
    loadImage(fighterUrl),
    loadImage(shardUrl),
    loadImage(fluxUrl),
    loadImage(prismUrl),
  ]);

  const fighterData = toImageData(fighterImg);
  const shardData = toImageData(shardImg);
  const fluxData = toImageData(fluxImg);
  const prismData = toImageData(prismImg);

  // Prism: keep cyan pixels as the shell, magenta pixels as the core (the
  // provided art is cyan-shell / magenta-core). A prism whose shell band is B
  // has core band opposite(B), so map shell-family -> B and core-family -> !B.
  const prismFull = {
    [CYAN]: recolor(prismData, (f) => (f === "cyan" ? CYAN : MAGENTA)),
    [MAGENTA]: recolor(prismData, (f) => (f === "cyan" ? MAGENTA : CYAN)),
  } as Record<Band, HTMLCanvasElement>;

  // Core-only: drop the shell (cyan-family) pixels and neutral pixels outside
  // the core, tint the remaining core to the requested band.
  const prismCore = {
    [CYAN]: recolor(
      prismData,
      (f) => (f === "magenta" ? CYAN : "drop"),
      15,
    ),
    [MAGENTA]: recolor(
      prismData,
      (f) => (f === "magenta" ? MAGENTA : "drop"),
      15,
    ),
  } as Record<Band, HTMLCanvasElement>;

  return {
    fighter: {
      [CYAN]: singleBand(fighterData, CYAN),
      [MAGENTA]: singleBand(fighterData, MAGENTA),
    } as Record<Band, HTMLCanvasElement>,
    shard: {
      [CYAN]: singleBand(shardData, CYAN),
      [MAGENTA]: singleBand(shardData, MAGENTA),
    } as Record<Band, HTMLCanvasElement>,
    fluxHeld: {
      [CYAN]: singleBand(fluxData, CYAN),
      [MAGENTA]: singleBand(fluxData, MAGENTA),
    } as Record<Band, HTMLCanvasElement>,
    fluxShimmer: makeCanvas(fluxData),
    prismFull,
    prismCore,
    burst: droneBurst as unknown as ParticleSystem,
  };
}
