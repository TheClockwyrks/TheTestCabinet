// Spectra — deriving the two band-states from one seeded silhouette.
//
// `specs/assets.md` seeds each sprite in ONE band-state and asks the build for
// the other: the same silhouette carrying the other band's colour, never a cyan
// diamond or a magenta ring. This file does that derivation ONCE at load time, so
// nothing is recomputed per frame.
//
// THE SILHOUETTE IS THE SEEDED ONE. Every derived raster keeps each source
// pixel's alpha exactly as the PNG has it, and the ring and diamond accents are
// drawn IN CODE over the sprite (`src/render.ts`) rather than baked in — so what
// reaches `drawImage` always carries the seeded shape.
//
// A pixel's band is read off its own colour rather than off a mask, because the
// seeded art is flat pixel art in exactly the two band colours: `#34e2ff` cyan
// and `#ff4ec7` magenta, over a white-ish hull, a warm thruster accent and a dark
// disc, which are neutral and are kept as they are.

import { SPRITE_SIZE, opposite, type Band } from "./constants";
import { BAND_RGB } from "./theme";

/** A decoded RGBA raster: the shape `ImageData` and `@napi-rs/canvas` share. */
export interface Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** What a source pixel carries. */
export type Family = "none" | "cyan" | "magenta";

/** What a derived pixel becomes. */
export type Target = Band | "keep" | "drop";

/**
 * Which band family a source pixel belongs to.
 *
 * A pixel too dark or too desaturated to read as either band is neutral: the
 * white hull, the grey shading, the warm thruster and the Prism's dark disc.
 */
export function classify(r: number, g: number, b: number): Family {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 8) return "none";
  if ((max - min) / max < 0.28) return "none";
  // Cyan reads as high green and blue over low red; magenta as high red and blue
  // over low green.
  if (b > 60 && g >= r && b >= r) return "cyan";
  if (r > 60 && r >= g && b >= g) return "magenta";
  return "none";
}

/** An empty raster of the seeded sprite's size. */
function blank(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/**
 * Map every band-carrying pixel of `src` through `map`, keeping each pixel's
 * alpha.
 *
 * `keepNeutralWithin`, where given, drops a neutral pixel further than that many
 * pixels from the sprite's centre — which is how a Prism's core is separated
 * from the shell's white highlights.
 */
export function recolor(
  src: Raster,
  map: (family: Family) => Target,
  keepNeutralWithin?: number,
): Raster {
  const out = blank(src.width, src.height);
  const cx = (src.width - 1) / 2;
  const cy = (src.height - 1) / 2;
  for (let i = 0; i < src.data.length; i += 4) {
    const r = src.data[i] ?? 0;
    const g = src.data[i + 1] ?? 0;
    const b = src.data[i + 2] ?? 0;
    const a = src.data[i + 3] ?? 0;
    if (a === 0) continue;
    const family = classify(r, g, b);
    let target: Target;
    if (family === "none") {
      target = "keep";
      if (keepNeutralWithin !== undefined) {
        const px = (i / 4) % src.width;
        const py = Math.floor(i / 4 / src.width);
        if (Math.hypot(px - cx, py - cy) > keepNeutralWithin) target = "drop";
      }
    } else {
      target = map(family);
    }
    if (target === "drop") continue;
    if (target === "keep") {
      out.data[i] = r;
      out.data[i + 1] = g;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
      continue;
    }
    // The band's colour, dimmed to the source pixel's own brightness, so the
    // art's shading survives the re-tint.
    const value = Math.max(r, g, b) / 255;
    const rgb = BAND_RGB[target];
    out.data[i] = Math.round(rgb[0] * value);
    out.data[i + 1] = Math.round(rgb[1] * value);
    out.data[i + 2] = Math.round(rgb[2] * value);
    out.data[i + 3] = a;
  }
  return out;
}

/** Every band-carrying pixel collapsed onto one band. */
export function singleBand(src: Raster, band: Band): Raster {
  return recolor(src, () => band);
}

/** The radius, in sprite pixels, a Prism's core and its highlights sit within. */
export const PRISM_CORE_RADIUS = 17;

/** A Prism with its shell intact, whose shell carries `shell`. */
export function prismFull(src: Raster, shell: Band): Raster {
  // The seeded Prism is a cyan shell around a magenta core, so the cyan family
  // is the shell and the magenta family is the core.
  return recolor(src, (family) =>
    family === "cyan" ? shell : opposite(shell),
  );
}

/** A Prism with only its core left, whose core carries `core`. */
export function prismCore(src: Raster, core: Band): Raster {
  return recolor(
    src,
    (family) => (family === "magenta" ? core : "drop"),
    PRISM_CORE_RADIUS,
  );
}

/** The four seeded rasters, by the sprite each belongs to. */
export interface SpriteRasters {
  fighter: Raster;
  shard: Raster;
  flux: Raster;
  prism: Raster;
}

/** Every band-state the game draws, as rasters, before they become sprites. */
export interface ArtRasters {
  fighter: Record<Band, Raster>;
  shard: Record<Band, Raster>;
  fluxHeld: Record<Band, Raster>;
  fluxShimmer: Raster;
  prismFull: Record<Band, Raster>;
  prismCore: Record<Band, Raster>;
}

/**
 * Derive every band-state from the four seeded rasters.
 *
 * Pure, so it is checked without a browser: the caller turns each raster into
 * something `drawImage` accepts.
 */
export function deriveArt(sources: SpriteRasters): ArtRasters {
  return {
    fighter: {
      cyan: singleBand(sources.fighter, "cyan"),
      magenta: singleBand(sources.fighter, "magenta"),
    },
    shard: {
      cyan: singleBand(sources.shard, "cyan"),
      magenta: singleBand(sources.shard, "magenta"),
    },
    fluxHeld: {
      cyan: singleBand(sources.flux, "cyan"),
      magenta: singleBand(sources.flux, "magenta"),
    },
    // Mid-shimmer the Flux is settled on neither band, and the seeded art is
    // exactly that: both bands at once, so it is used as it comes.
    fluxShimmer: sources.flux,
    prismFull: {
      cyan: prismFull(sources.prism, "cyan"),
      magenta: prismFull(sources.prism, "magenta"),
    },
    prismCore: {
      cyan: prismCore(sources.prism, "cyan"),
      magenta: prismCore(sources.prism, "magenta"),
    },
  };
}

/** How many pixels of `raster` are not fully transparent. */
export function opaqueCount(raster: Raster): number {
  let count = 0;
  for (let i = 3; i < raster.data.length; i += 4) {
    if ((raster.data[i] ?? 0) > 0) count += 1;
  }
  return count;
}

/** The sprite canvas every seeded PNG is decoded onto. */
export const SPRITE_RASTER_SIZE = SPRITE_SIZE;
