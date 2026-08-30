// Spectra — the look: the palette, the layer order, and the two band filters.
//
// `specs/overview.md` fixes no palette, no typeface and no HUD layout: it fixes
// the RELATIONSHIPS a player must be able to read at a glance, and leaves every
// value behind them to the build. This module is that choice, in one place, so
// nothing anywhere else in the build writes a colour literal.
//
// THE TWO BAND COLOURS ARE THE ART'S. `specs/assets.md` seeds four PNGs that
// already carry cyan and magenta, and the legibility table's "One palette for
// both" row requires everything the build draws in code in a band to use those
// same two colours. `BAND` below is therefore read off the seeded art rather
// than invented: `#34e2ff` is the fighter's core and the Prism's shell, and
// `#ff4ec7` is the Shard's crystal and the Prism's core. `GOLD` and `HULL` are
// the fighter's own two neutrals, reused for the charge telegraph and the text
// so the whole screen belongs to one drawing.
//
// THE BAND FILTER is how a sprite reaches the other band-state.
// `specs/assets.md` offers two routes — composite the tint over the seeded PNG
// at draw time, or bake a per-band copy at load time — and this build takes the
// first, through `CanvasRenderingContext2D.filter`. A chain of
// `grayscale → brightness → sepia → hue-rotate → saturate` maps every pixel of
// the seeded silhouette onto one band's colour while leaving its alpha, and so
// its shape, untouched: the source handed to `drawImage` is always the seeded
// bitmap. The route needs no second canvas, which is what makes it work
// identically in a browser and in a host that has no `document` to make one
// with.
//
// `value` is the shade a layer is drawn at, `1` being the band's own colour, and
// `luma` is the grey the source pixel arrives as. The chain is calibrated on the
// Shard's magenta (`#ff4ec7`, a luma of 124), so a source of another brightness
// is normalised back onto that calibration point before the hue is applied and
// every sprite lands on the same band colour.

import { STAGE_H, STAGE_W } from "./constants";
import type { Band } from "./game";

/** The two band colours, read off the seeded art. */
export const BAND: Readonly<Record<Band, string>> = {
  cyan: "#34e2ff",
  magenta: "#ff4ec7",
};

/** The same two, as channels, for the code-drawn glows that need an alpha. */
export const BAND_RGB: Readonly<
  Record<Band, readonly [number, number, number]>
> = {
  cyan: [52, 226, 255],
  magenta: [255, 78, 199],
};

/** The neutrals: the fighter's hull, its thruster gold, and the field. */
export const COLOR = {
  /** The stage background, which the letterbox bars carry too. */
  space: "#070b16",
  /** The play field, between the two HUD strips. */
  field: "#0b1020",
  /** The HUD strips above and below the field. */
  strip: "#05080f",
  /** The hairline that separates a strip from the field. */
  rule: "#1b2440",
  /** Body text and every readout. */
  text: "#eaf0fb",
  /** Text that is present but not the point. */
  dim: "#7f8db0",
  /** The charge telegraph and every highlight, from the fighter's thruster. */
  gold: "#ffd86b",
  /** The two starfield shades, both dimmer than either band. */
  starFar: "#232d47",
  starNear: "#39456b",
} as const;

/** The type the whole game is set in. */
export const FONT = {
  huge: "700 84px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  title: "700 44px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  heading: "700 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  body: "500 22px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  small: "500 17px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  digits: "700 34px ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/**
 * The layer each part of the picture draws on, ascending. The pipeline sorts by
 * layer, so the order the picture overlaps in is this table rather than the
 * order the components happen to be attached in.
 */
export const LAYER = {
  field: 0,
  starfield: 4,
  inversion: 8,
  drones: 12,
  bullets: 16,
  ship: 20,
  bursts: 24,
  discharge: 28,
  hud: 32,
  screens: 36,
} as const;

/** The centre of the stage, which every screen is laid out around. */
export const CENTER_X = STAGE_W / 2;
export const CENTER_Y = STAGE_H / 2;

/** The grey the band filter is calibrated on: the Shard's magenta. */
const CALIBRATION_LUMA = 124;

/** The luma of each band's own colour, so a source of one can be normalised. */
export const BAND_LUMA: Readonly<Record<Band, number>> = {
  cyan: 191,
  magenta: 124,
};

/** The white the seeded highlights arrive as. */
export const WHITE_LUMA = 255;

/** Per band: the brightness that lands the calibration grey on the band. */
const BAND_BRIGHTNESS: Readonly<Record<Band, number>> = {
  cyan: 1.3,
  magenta: 1.1,
};

/** Per band: the hue the sepia base is rotated to, and how far it is pushed. */
const BAND_HUE: Readonly<Record<Band, number>> = { cyan: 160, magenta: 290 };
const BAND_SATURATE: Readonly<Record<Band, number>> = { cyan: 4, magenta: 7 };

/**
 * The filter that draws a seeded sprite in `band`.
 *
 * `luma` is the grey the pixels being coloured arrive as, and `value` the shade
 * the layer is drawn at — the Prism's shell sits below `1` so the two drones
 * that share a band still read apart. The result keeps the source's alpha, so
 * the silhouette on screen is the seeded one.
 */
export function bandFilter(
  band: Band,
  luma = CALIBRATION_LUMA,
  value = 1,
): string {
  const brightness = (BAND_BRIGHTNESS[band] * CALIBRATION_LUMA * value) / luma;
  return (
    `grayscale(1) brightness(${brightness.toFixed(3)}) sepia(1) ` +
    `hue-rotate(${BAND_HUE[band]}deg) saturate(${BAND_SATURATE[band]})`
  );
}

/** One of the two band colours as `rgba`, for a glow or a wash. */
export function bandAlpha(band: Band, alpha: number): string {
  const [r, g, b] = BAND_RGB[band];
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The gold telegraph colour as `rgba`. */
export function goldAlpha(alpha: number): string {
  return `rgba(255, 216, 107, ${alpha})`;
}
