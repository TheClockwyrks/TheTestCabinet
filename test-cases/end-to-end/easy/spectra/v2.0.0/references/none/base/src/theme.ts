// Spectra — the look: the palette, the type, and the two band colours.
//
// The specification fixes no colour and no typeface (specs/overview.md), with one
// relationship it does fix: EVERYTHING THE BUILD DRAWS IN CODE THAT CARRIES A
// BAND USES THE SAME TWO COLOURS THE SEEDED ART CARRIES, so a code-drawn bullet
// and a sprite-drawn drone of one band read as the same band. `BAND_COLOR` below
// is therefore read off the seeded PNGs rather than chosen: `#34e2ff` is the cyan
// of `fighter.png`'s core, `flux.png` and `prism.png`'s shell, and `#ff4ec7` the
// magenta of `shard.png`'s crystal and `prism.png`'s core.
//
// Everything else here is this build's own choice.

import type { Band } from "./constants";

/** The two band colours, as the seeded art carries them. */
export const BAND_COLOR: Record<Band, string> = {
  cyan: "#34e2ff",
  magenta: "#ff4ec7",
};

/** The same two, as `0..255` RGB, for a tint composited over a sprite. */
export const BAND_RGB: Record<Band, readonly [number, number, number]> = {
  cyan: [0x34, 0xe2, 0xff],
  magenta: [0xff, 0x4e, 0xc7],
};

/** The palette. Dark field, cool chrome, one warm accent for the meter. */
export const COLOR = {
  /** The stage background, and what the letterbox bars carry. */
  bg: "#05060f",
  /** The play field, a shade above the stage so its edges read. */
  field: "#080b18",
  /** The two HUD strips. */
  hud: "#0b1020",
  /** The hairline between a strip and the field. */
  rule: "#1a2440",
  /** A starfield mark, well below either band's brightness. */
  star: "#283250",
  /** A brighter starfield mark. */
  starBright: "#3a4770",
  /** Body text. */
  text: "#e8eef7",
  /** A secondary readout. */
  textDim: "#8893ad",
  /** An unhighlighted menu item. */
  textFaint: "#59637f",
  /** The resonance meter's fill. */
  resonance: "#ffd86b",
  /** The resonance meter's fill once a discharge is ready. */
  resonanceReady: "#fff6cf",
  /** The discharge wave. */
  discharge: "#ffffff",
  /** The field-wide inversion mark. */
  inversion: "#b98cff",
} as const;

/** A system font stack: nothing is downloaded, so the game renders offline. */
export const FONT =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
