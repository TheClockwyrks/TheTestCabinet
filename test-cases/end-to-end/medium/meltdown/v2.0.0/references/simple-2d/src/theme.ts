// Meltdown — this build's own look.
//
// The specification deliberately fixes no palette, no typeface, no tower
// artwork and no panel layout (specs/overview.md, Visual design), so everything
// aesthetic lives here and in `src/panel.ts`, apart from the case-fixed figures
// in `src/constants.ts`.
//
// The reactor is a cold, dark box and the action is lit by heat, so the one
// axis that carries meaning is the emitter ramp: TEAL when cold, ORANGE at the
// middle of the scale, WHITE-HOT at the top. Everything a player must tell
// apart from that ramp is deliberately placed off it — the six surge types are
// green, pink, indigo, lime, cyan and violet, and a tripped tower is a dead
// blood red that appears nowhere on the ramp. `theme.test.ts` measures every one
// of those separations, so a colour edited here fails a test rather than a
// review.

import type { SurgeType } from "./constants";

export const COLOR = {
  /** The stage background, and the letterbox bars around it. */
  bg: "#05070a",
  /** The reactor floor inside the casing. */
  floor: "#161c23",
  /** The tile grid drawn over the floor. */
  grid: "#26303a",
  /** The buildable zone a mode restricts building to. */
  zone: "#1d3040",
  zoneEdge: "#3f6f8c",
  /** The casing band, and the two kinds of opening cut into it. */
  casing: "#6d6353",
  casingEdge: "#8d8371",
  vent: "#2ea8d8",
  exhaust: "#e0472e",
  /** The build panel. */
  panel: "#0d1218",
  panelEdge: "#2a3542",
  slot: "#18212b",
  slotEdge: "#33404f",
  slotDisabled: "#121820",
  /** Text. */
  text: "#e8eef5",
  dim: "#8b9bab",
  bright: "#ffffff",
  /** The menu highlight. */
  highlight: "#ffb454",
  /** Overlay scrims and panels. */
  scrim: "#05070ac4",
  overlay: "#101821",
  /** Build preview states. */
  valid: "#4ade80",
  invalid: "#f2545b",
  /** A tower's radiator faces, and the ring range is drawn at. */
  radiator: "#7ef2ff",
  ring: "#9fd8ff",
  /** Health and heat bars. */
  hp: "#4ade5f",
  hpBack: "#2a1418",
  redlineMark: "#ff3b30",
} as const;

/** The emitter heat ramp: cold, half way, and white-hot. */
export const HEAT_RAMP = {
  cold: [43, 127, 158] as const,
  mid: [212, 118, 28] as const,
  hot: [255, 240, 207] as const,
};

/** A tripped emitter's body, which sits nowhere on the ramp above. */
export const TRIPPED_RGB: readonly [number, number, number] = [122, 15, 31];

/** One colour per surge type, each held off the heat ramp. */
export const SURGE_COLOR: Readonly<Record<SurgeType, string>> = {
  mote: "#3ddc5a",
  sprint: "#ff53a8",
  hulk: "#6f5bff",
  swarm: "#c6ff2e",
  drift: "#21d3f0",
  core: "#8a00c8",
};

/** The `[r, g, b]` of a 6-digit hex colour, for tests that read pixels. */
export function rgbOf(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * The colour an online emitter at `heat` is drawn in, as `[r, g, b]`. The ramp
 * runs cold -> mid across the bottom half of the scale and mid -> white-hot
 * across the top, so the cold end and the near-redline end read plainly apart.
 */
export function heatRgb(heat: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, heat / 100));
  return t <= 0.5
    ? mix(HEAT_RAMP.cold, HEAT_RAMP.mid, t / 0.5)
    : mix(HEAT_RAMP.mid, HEAT_RAMP.hot, (t - 0.5) / 0.5);
}

/** A `[r, g, b]` triple as a CSS colour. */
export function css(rgb: readonly [number, number, number]): string {
  return `rgb(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])})`;
}

/** The body colour of a tower at `heat`, tripped or not. */
export function towerBody(heat: number, tripped: boolean): string {
  return css(tripped ? TRIPPED_RGB : heatRgb(heat));
}

/** A hex colour with an alpha, as an 8-digit hex string. */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const byte = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${byte}`;
}

const FONT_FAMILY =
  '"Bahnschrift", "Segoe UI", "Helvetica Neue", system-ui, sans-serif';

/** A canvas font string at a size and weight, in this build's one face. */
export function font(size: number, weight = 600): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}
