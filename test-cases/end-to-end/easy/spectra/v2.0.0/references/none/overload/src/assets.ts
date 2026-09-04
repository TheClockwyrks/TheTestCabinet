// Spectra — the seeded art, and the second band derived from it.
//
// `specs/assets.md` seeds four `SPRITE_SIZE` PNGs and one particle system, and
// fixes two things about how the build uses them: EVERY ENTITY IS DRAWN FROM ITS
// OWN SPRITE, and the band-state the file does not carry is THE SAME SILHOUETTE in
// the other band's colour. This module is the whole of that derivation.
//
// The choice the spec leaves open — composite the tint at draw time, or bake a
// per-band copy once at load — is taken here as BAKE ONCE. Two reasons: a bake
// keeps the alpha silhouette of the seeded file exactly, pixel for pixel, so both
// band-states really are one silhouette; and a frame that draws thirty drones then
// costs thirty `drawImage` calls rather than thirty offscreen composites.
//
// The seeded files are hard-edged pixel art: four colours at most, alpha either 0
// or 255. So a retint is an exact colour swap rather than a hue rotation, and it is
// a pure function of a pixel buffer — which is what lets it be tested with no
// canvas at all.
//
// A PRISM'S CORE is the one derivation that is not a recolour. `prism.png` draws a
// shell around a core with an opaque gap between them, and a Prism with its shell
// broken draws THE INNER LAYER ALONE. The core is lifted out by flooding from the
// centre of the sprite across everything that is neither the shell's colour nor the
// gap's, which is exactly the core and its own facet lines: the gap the flood
// cannot cross is what separates the two layers.

import { BAND_COLOR } from "./theme";
import { BURST_SYSTEM, SPRITE_SIZE, SPRITES, opposite } from "./constants";
import { loadImage, loadParticleSystem, assetUrl } from "./images";
import type { Band } from "./types";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";

/** An opaque RGB triple, as the seeded art carries it. */
export type Rgb = readonly [number, number, number];

/**
 * The three colours the seeded art is drawn in that this module has to recognize.
 *
 * They are facts about the supplied files rather than figures the specification
 * fixes, which is why they live here and not in `src/constants.ts`.
 */
export const ART = {
  /** The cyan the fighter's core, the Flux and the Prism's shell are drawn in. */
  cyan: [0x34, 0xe2, 0xff] as Rgb,
  /** The magenta the Shard, the Flux and the Prism's core are drawn in. */
  magenta: [0xff, 0x4e, 0xc7] as Rgb,
  /** The opaque dark gap between a Prism's shell and its core. */
  gap: [0x0b, 0x10, 0x20] as Rgb,
} as const;

/**
 * How near a pixel must be to one of {@link ART}'s colours to count as it.
 *
 * The seeded files carry four exact colours, so any small figure works; this one
 * is loose enough to survive a re-export of the art through a lossless encoder
 * that nudges a channel, and far tighter than the distance between the two bands.
 */
export const COLOR_TOLERANCE = 24;

/** `#rrggbb` as a triple. */
export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Whether the pixel at `offset` is within {@link COLOR_TOLERANCE} of `rgb`. */
export function pixelIs(
  data: Uint8ClampedArray,
  offset: number,
  rgb: Rgb,
): boolean {
  const dr = data[offset] - rgb[0];
  const dg = data[offset + 1] - rgb[1];
  const db = data[offset + 2] - rgb[2];
  return Math.hypot(dr, dg, db) <= COLOR_TOLERANCE;
}

/** Write `rgb` into the pixel at `offset`, leaving its alpha alone. */
function writePixel(data: Uint8ClampedArray, offset: number, rgb: Rgb): void {
  data[offset] = rgb[0];
  data[offset + 1] = rgb[1];
  data[offset + 2] = rgb[2];
}

/**
 * Retint every band-carrying pixel to one band's colour, in place.
 *
 * What derives a cyan Shard from the seeded magenta one, and a Flux settled on a
 * band from the seeded mid-shimmer art: the silhouette and every non-band pixel
 * (the white facets, the hull) are untouched, so only the band changes.
 */
export function retintToBand(data: Uint8ClampedArray, band: Band): void {
  const target = hexToRgb(BAND_COLOR[band]);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    if (pixelIs(data, offset, ART.cyan) || pixelIs(data, offset, ART.magenta)) {
      writePixel(data, offset, target);
    }
  }
}

/**
 * Retint only the pixels of one art colour, in place.
 *
 * What derives the magenta ship: `fighter.png` is the hull in white with its core
 * in cyan, and the magenta ship is the same hull with the CORE recoloured.
 */
export function retintOneColor(
  data: Uint8ClampedArray,
  from: Rgb,
  band: Band,
): void {
  const target = hexToRgb(BAND_COLOR[band]);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    if (pixelIs(data, offset, from)) writePixel(data, offset, target);
  }
}

/**
 * Swap the two bands' pixels for one another, in place.
 *
 * What derives the magenta-shell Prism: the same two-layer construction with the
 * two bands the other way round.
 */
export function swapBands(data: Uint8ClampedArray): void {
  const cyan = hexToRgb(BAND_COLOR.cyan);
  const magenta = hexToRgb(BAND_COLOR.magenta);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    if (pixelIs(data, offset, ART.cyan)) writePixel(data, offset, magenta);
    else if (pixelIs(data, offset, ART.magenta)) writePixel(data, offset, cyan);
  }
}

/**
 * Keep a Prism's inner core alone, clearing every other pixel, in place.
 *
 * A four-neighbour flood from the centre of the sprite across every drawn pixel
 * that is neither `shell` nor the gap colour. The gap is opaque and it rings the
 * core, so the flood cannot reach the shell: what it visits is the core and the
 * facet lines drawn over it, and nothing else.
 */
export function keepCoreOnly(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  shell: Rgb,
): void {
  const keep = new Uint8Array(width * height);
  const start = (height >> 1) * width + (width >> 1);
  const queue: number[] = [start];
  keep[start] = 1;
  while (queue.length > 0) {
    const index = queue.pop() as number;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (keep[next] === 1) continue;
      const offset = next * 4;
      if (data[offset + 3] === 0) continue;
      if (pixelIs(data, offset, shell) || pixelIs(data, offset, ART.gap))
        continue;
      keep[next] = 1;
      queue.push(next);
    }
  }
  for (let index = 0; index < keep.length; index += 1) {
    if (keep[index] === 0) data[index * 4 + 3] = 0;
  }
}

/** The decoded art, with both band-states of everything that carries a band. */
export interface Sprites {
  /** The ship, per band. `fighter.png` is the cyan one. */
  fighter: Readonly<Record<Band, CanvasImageSource>>;
  /** A Shard, per band. `shard.png` is the magenta one. */
  shard: Readonly<Record<Band, CanvasImageSource>>;
  /** A Flux settled on a band, per band. */
  fluxHeld: Readonly<Record<Band, CanvasImageSource>>;
  /** A Flux mid-shimmer, showing both bands at once: the seeded file itself. */
  fluxShimmer: CanvasImageSource;
  /** A Prism with its shell intact, keyed by the SHELL's band. */
  prismShell: Readonly<Record<Band, CanvasImageSource>>;
  /** A Prism's core alone, keyed by the SHELL's band; the core is the opposite. */
  prismCore: Readonly<Record<Band, CanvasImageSource>>;
  /** The seeded particle system a destroyed drone pops with. */
  burst: ParticleSystem | null;
}

/** A `SPRITE_SIZE` square canvas carrying `source`, with its pixels reachable. */
function bake(
  source: CanvasImageSource,
  edit: (data: Uint8ClampedArray) => void,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const image = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  edit(image.data);
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Load the four sprites and the burst system, and derive every band-state. */
export async function loadSprites(): Promise<Sprites> {
  const [fighter, shard, flux, prism, burst] = await Promise.all([
    loadImage(assetUrl(SPRITES.fighter)),
    loadImage(assetUrl(SPRITES.shard)),
    loadImage(assetUrl(SPRITES.flux)),
    loadImage(assetUrl(SPRITES.prism)),
    loadParticleSystem(BURST_SYSTEM),
  ]);

  const shellBands: readonly Band[] = ["cyan", "magenta"];
  const prismShell = {} as Record<Band, CanvasImageSource>;
  const prismCore = {} as Record<Band, CanvasImageSource>;
  for (const band of shellBands) {
    prismShell[band] = bake(prism, (data) => {
      if (band === "magenta") swapBands(data);
    });
    // The core is the band opposite the shell's, so the pixels to keep are the
    // ones that are NOT the shell's colour once the shell's band is settled.
    prismCore[band] = bake(prism, (data) => {
      if (band === "magenta") swapBands(data);
      keepCoreOnly(data, SPRITE_SIZE, SPRITE_SIZE, hexToRgb(BAND_COLOR[band]));
    });
  }

  return {
    fighter: {
      // `fighter.png` is already the cyan ship, and it is baked all the same so
      // both band-states are the same kind of source and the same size.
      cyan: bake(fighter, (data) => retintOneColor(data, ART.cyan, "cyan")),
      magenta: bake(fighter, (data) =>
        retintOneColor(data, ART.cyan, "magenta"),
      ),
    },
    shard: {
      cyan: bake(shard, (data) => retintToBand(data, "cyan")),
      magenta: bake(shard, (data) => retintToBand(data, "magenta")),
    },
    fluxHeld: {
      cyan: bake(flux, (data) => retintToBand(data, "cyan")),
      magenta: bake(flux, (data) => retintToBand(data, "magenta")),
    },
    fluxShimmer: flux,
    prismShell,
    prismCore,
    burst,
  };
}

/** The band a Prism's exposed layer is drawn in, given its stored shell band. */
export function exposedLayerBand(shellBand: Band, shellAlive: boolean): Band {
  return shellAlive ? shellBand : opposite(shellBand);
}
