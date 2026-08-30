// Meltdown — the look.
//
// `src/constants.ts` deliberately carries no color and no type face: the
// specification fixes what a player has to READ at a glance (specs/overview.md,
// Visual design) and leaves the palette to the build. This module is that
// choice, gathered in one place so every drawing module reads the same values
// and so the separations the legibility table demands are visible together.
//
// The reactor is dark and industrial and the action is lit by heat, so the one
// axis that carries information is the heat ramp: steel blue when cold, amber
// through the middle, and near-white at the trip. Everything a player must not
// confuse with heat is kept off that axis — the surge is green, violet and
// magenta, a tripped tower is a dark carmine no live heat reaches, and the
// casing is a neutral grey. The distances below are stated as the sum of the
// three channel differences, out of 765.

/** A CSS color as three channels, so a separation can be stated. */
export type Rgb = readonly [number, number, number];

/** The sum of the per-channel differences: 0 for a match, 765 at the extremes. */
export function separation(a: Rgb, b: Rgb): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** A color as a CSS string. */
export function css(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** The same color with an alpha, for a wash over something already drawn. */
export function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** The three stops of the heat ramp: cold, the amber middle, and white-hot. */
export const RAMP_COLD: Rgb = [46, 91, 138];
export const RAMP_MID: Rgb = [224, 138, 36];
export const RAMP_HOT: Rgb = [255, 242, 204];

/** Where the amber stop sits along the ramp. */
const RAMP_MID_AT = 0.55;

/**
 * The color an emitter is drawn at, as a function of its heat. Two linear
 * segments through the three stops above, so the cold end and the near-redline
 * end sit 392 apart out of 765.
 */
export function heatRgb(heat: number): Rgb {
  const t = Math.max(0, Math.min(1, heat / 100));
  const [from, to, u] =
    t <= RAMP_MID_AT
      ? [RAMP_COLD, RAMP_MID, t / RAMP_MID_AT]
      : [RAMP_MID, RAMP_HOT, (t - RAMP_MID_AT) / (1 - RAMP_MID_AT)];
  return [
    Math.round(from[0] + (to[0] - from[0]) * u),
    Math.round(from[1] + (to[1] - from[1]) * u),
    Math.round(from[2] + (to[2] - from[2]) * u),
  ];
}

/** The whole palette, as raw channels so separations stay checkable. */
export const RGB = {
  /** The stage background, and the letterbox bars around it. */
  bg: [10, 13, 18],
  panel: [26, 31, 40],
  panelEdge: [58, 68, 84],
  floor: [22, 27, 34],
  grid: [43, 52, 64],
  casing: [138, 148, 166],
  casingEdge: [91, 101, 119],
  vent: [51, 196, 255],
  exhaust: [255, 65, 54],
  zone: [46, 72, 120],
  zoneEdge: [110, 168, 255],
  text: [240, 244, 250],
  textDim: [141, 153, 173],
  textBad: [255, 123, 107],
  textGood: [124, 240, 160],
  /** A radiator face against a plain one: 509 apart. */
  radiator: [150, 240, 255],
  plainFace: [40, 44, 52],
  /**
   * A tripped tower. It is drawn in this color at every heat, so what it has
   * to read apart from is the whole ramp rather than one stop of it: its
   * closest approach to any color the ramp shows is 164, and the hazard
   * stripes drawn over it are further still.
   */
  tripped: [110, 10, 36],
  trippedMark: [255, 90, 80],
  forge: [201, 119, 42],
  sink: [46, 168, 200],
  previewValid: [140, 255, 255],
  previewInvalid: [255, 90, 90],
  ring: [230, 240, 255],
  barTrack: [16, 19, 24],
  redline: [255, 255, 255],
  healthTrack: [30, 12, 12],
  health: [90, 255, 120],
  select: [255, 214, 92],
} as const satisfies Readonly<Record<string, Rgb>>;

/** The color each surge type is drawn in, all of them off the heat ramp. */
export const SURGE_RGB = {
  mote: [110, 240, 110],
  sprint: [170, 255, 90],
  hulk: [60, 215, 60],
  swarm: [120, 255, 180],
  drift: [200, 120, 255],
  core: [255, 70, 150],
} as const satisfies Readonly<Record<string, Rgb>>;

/** The type stack every readout and every screen is drawn in. */
export const FONT = {
  title: "700 76px ui-monospace, 'DejaVu Sans Mono', monospace",
  heading: "700 30px ui-monospace, 'DejaVu Sans Mono', monospace",
  menu: "600 26px ui-monospace, 'DejaVu Sans Mono', monospace",
  body: "400 17px ui-monospace, 'DejaVu Sans Mono', monospace",
  label: "600 14px ui-monospace, 'DejaVu Sans Mono', monospace",
  small: "400 13px ui-monospace, 'DejaVu Sans Mono', monospace",
  readout: "700 24px ui-monospace, 'DejaVu Sans Mono', monospace",
} as const;
