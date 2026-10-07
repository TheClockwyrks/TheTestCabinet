// Volute — the hall's palette (specs/assets.md "The hall").
//
// The produced sprites were drawn against these colors, so the chrome that is
// drawn in code — the HUD, the screens, the sightline, the danger read, the plate's
// seams — reads as part of the same place rather than as a layer over it.

import type { ChargeId } from "./constants";

/** The hall: cold blue-grey cast metal, deep and hot. */
export const COLOR = {
  /** Behind everything, and the color the letterbox bars carry. */
  field: "#0a0e12",
  /** Every sprite's edge, and the line the chrome is outlined in. */
  outline: "#0c1115",
  plateDeep: "#161c21",
  plateBase: "#212930",
  plateLit: "#2d373f",
  plateBevel: "#3d4a54",
  steel: "#8fa3b0",
  steelLit: "#c9d6dd",
  condensation: "#4a5f6c",
  rustDeep: "#5a3a24",
  rust: "#7a5030",
  lamp: "#ff8a3c",
  lampLit: "#ffcd8c",
  ember: "#963410",
  hazard: "#c68a2c",
} as const;

/** The color each charge is drawn in: the light step of its produced ramp. */
export const CHARGE_COLOR: Readonly<Record<ChargeId, string>> = {
  halide: "#3fd6e6",
  sulfur: "#ffc61e",
  cobalt: "#6c5cff",
  garnet: "#ff3f5e",
  olivine: "#8ede3c",
};

/** The type the chrome is set in. */
export const FONT = {
  /** The face every readout and every screen uses. */
  family:
    '"Eurostile", "Bahnschrift", "DIN Alternate", "Segoe UI", system-ui, sans-serif',
  /** The face the numbers are set in, so digits keep their columns. */
  mono: '"SFMono-Regular", "Consolas", "Liberation Mono", monospace',
} as const;

/** A CSS color string for one of the hall's colors at a given opacity. */
export function fade(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
