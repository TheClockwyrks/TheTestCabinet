// Spectra — this build's own look.
//
// `src/constants.ts` carries every figure the specification fixes and carries no
// colour and no typeface at all, because the specification fixes neither. What
// the field looks like is this build's design, and it lives here so the two are
// never confused for one another.
//
// The choices answer the legibility table in `specs/overview.md`. The field is a
// near-black void behind a cold starfield, so the only saturated things on it are
// the two bands. The two band colours are read off the seeded art rather than
// invented: `assets/shard.png` is drawn in `#ff4ec7` and the cyan half of
// `assets/flux.png` in `#34e2ff`, so every bullet, meter, indicator and glow this
// build draws in code carries the same pair the sprites do and a code-drawn
// bullet reads as the same band as a sprite-drawn drone.

import type { Band } from "./game";

/** The two band colours, taken from the seeded art. */
export const BAND_COLOR: Readonly<Record<Band, string>> = {
  cyan: "#34e2ff",
  magenta: "#ff4ec7",
};

/** A dimmer draw of each band, for a meter's track and a spent glow. */
export const BAND_DIM: Readonly<Record<Band, string>> = {
  cyan: "#12414f",
  magenta: "#4d1b3c",
};

/**
 * The band tint composited over a seeded sprite, as a canvas filter.
 *
 * `brightness(0) invert(1)` flattens whatever the sprite is drawn in to opaque
 * white, keeping its alpha, so the rest of the chain resolves to one flat colour
 * whichever sprite it is applied to. The result is `#34f2f2` for cyan and
 * `#ff61d3` for magenta, each a few units from the art's own value, which is what
 * a filter chain can reach without reading the sprite's pixels. The band still
 * reads correctly because the shape drawn is the seeded silhouette and the accent
 * drawn over it carries the exact colour above.
 */
export const BAND_TINT: Readonly<Record<Band, string>> = {
  cyan:
    "brightness(0) invert(1) sepia(1) saturate(64) hue-rotate(148deg) " +
    "brightness(0.8) contrast(1.5)",
  magenta:
    "brightness(0) invert(1) sepia(1) saturate(24) hue-rotate(278deg) " +
    "brightness(0.7) contrast(3)",
};

/**
 * How strongly each element takes its band tint.
 *
 * The three drone kinds and the ship take deliberately different strengths, so a
 * Shard, a Flux, a Prism and the ship of one band are four readings rather than
 * one: a Shard is very nearly the flat band colour, a Flux keeps enough of its
 * two-band body to read lighter, a Prism keeps its dark facets, and the ship's
 * white hull stays a hull.
 */
export const TINT = {
  shard: 0.86,
  flux: 0.5,
  prism: 0.62,
  ship: 0.42,
} as const;

/** Every colour this build draws in code. */
export const COLOR = {
  /** The stage background, which the letterbox bars carry as well. */
  background: "#05070f",

  /** The play field, and the vignette drawn down its edges. */
  field: "#080b16",
  fieldEdge: "#04060c",

  /** The two HUD strips and the rule that separates each from the field. */
  hud: "#02040a",
  hudEdge: "#1d2f47",

  /** The starfield: three depths, none of them as bright as a band. */
  starFar: "#1b2437",
  starMid: "#39496b",
  starNear: "#7d90b4",

  /** The wash a spectral inversion lays over the whole play field. */
  inversion: "rgba(196, 92, 255, 0.2)",
  inversionEdge: "#c45cff",

  /** The discharge wave: a white-hot rim inside a cool halo. */
  dischargeRim: "#f4fbff",
  dischargeHalo: "rgba(140, 220, 255, 0.28)",

  /** Text: the ordinary readout, the emphasis, and the quieted line. */
  text: "#dce7f7",
  textBright: "#ffffff",
  textDim: "#69809d",

  /** The accent the titles, the highlighted menu row and the banners carry. */
  accent: "#8ff2d8",
  /** The wash drawn over the field behind a menu or a banner. */
  scrim: "rgba(3, 5, 12, 0.78)",
  /** The lighter wash a banner over live play sits on. */
  scrimLight: "rgba(3, 5, 12, 0.5)",
} as const;

/**
 * The type. One squared-off family at a handful of sizes, which is what sits
 * with pixel art on a technical field.
 */
export const FONT_FAMILY =
  '"Consolas", "SF Mono", "DejaVu Sans Mono", "Courier New", monospace';

/** A CSS font shorthand at `size` logical units, bold unless told otherwise. */
export function font(size: number, weight: "bold" | "normal" = "bold"): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}
