// Volute — the hall's palette, its type, and the layer table (specs/assets.md
// "The hall", specs/ui.md "Presentation").
//
// The produced sprites were drawn against these colors, so the chrome that is
// drawn in code — the HUD, the screens, the sightline, the danger read, the
// plate's seams — reads as part of the same place rather than as a layer over
// it. `specs/ui.md` fixes no palette and no layout, so everything here is this
// build's own design.

import type { ChargeId } from "./constants";

/** The hall: cold blue-grey cast metal, deep and hot. */
export const COLOR = {
  /** Behind everything, and the color the letterbox bars carry. */
  field: "#0a0e12",
  /** Every sprite's edge, and the line the chrome is outlined in. */
  outline: "#0c1115",
  plateDeep: "#161c21",
  plateBase: "#212930",
  plateBevel: "#3d4a54",
  steel: "#8fa3b0",
  steelLit: "#c9d6dd",
  condensation: "#4a5f6c",
  lamp: "#ff8a3c",
  lampLit: "#ffcd8c",
  alarm: "#ff3f5e",
  alarmLit: "#ff8090",
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

/**
 * The rendering pipeline's layer table (the engine's `rendering.md`: number the
 * layers in one place and leave gaps).
 *
 * The order is the one `specs/assets.md` fixes: the channel plate under the
 * train, the cores with their marks and the injector above it, the sheets and
 * the particle effects above those, and the HUD and the screens last.
 */
export const LAYER = {
  plate: 0,
  intake: 10,
  coreGlow: 20,
  core: 21,
  coreMark: 22,
  injector: 30,
  projectile: 40,
  sightline: 50,
  effects: 60,
  hud: 70,
  screen: 80,
} as const;

/** A CSS color string for one of the hall's colors at a given opacity. */
export function fade(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
