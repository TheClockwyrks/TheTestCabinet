// Meltdown — the look, which is entirely this build's own.
//
// The specification fixes no palette and no typeface: it fixes what a player must
// be able to READ at a glance (specs/overview.md), and leaves the colours, the
// type and the glow to the build. These are the choices this build made, and they
// are gathered here so the whole of the look can be judged in one file.
//
// The one constraint the palette answers is the legibility table: the heat ramp
// runs blue to white through orange, so the surge is drawn in greens, cyans and
// magentas that sit nowhere on it; a tripped tower is a dark carcass with a red
// warning band rather than another point on the ramp; and a radiator face is a
// pale cyan bar no tower body ever shows.

/** The colour the whole canvas, letterbox bars included, is cleared to. */
export const BACKGROUND = "#07090c";

export const COLOR = {
  background: BACKGROUND,
  floor: "#161a21",
  floorEdge: "#1d222b",
  grid: "#272e3a",
  casing: "#4b5462",
  casingRim: "#6b7686",
  panel: "#11141a",
  panelEdge: "#2b323d",
  panelInset: "#1a1f27",

  vent: "#3f8fd8",
  exhaust: "#e0492b",

  heatCold: "#2e6fb7",
  heatWarm: "#f0a83a",
  heatHot: "#ff4a1c",
  heatWhite: "#fff2d8",

  radiator: "#9ff6ff",
  plainFace: "#171c24",
  tripBody: "#2a0f10",
  tripMark: "#ff2323",

  forge: "#ff7a1f",
  sink: "#a9c8de",

  ground: "#7ee03a",
  flyer: "#c86bff",
  boss: "#ff2fa0",
  health: "#39d98a",
  healthBack: "#0d1014",

  zone: "#4fd0c0",
  valid: "#46d07a",
  invalid: "#ff4d4d",
  range: "#9ff6ff",

  text: "#e6edf5",
  textDim: "#9aa7b6",
  textFaint: "#5d6a79",
  money: "#ffcf4d",
  lives: "#ff8a6b",
  highlight: "#ffcf4d",
} as const;

/** The type stack. A monospace face keeps every readout on one rhythm. */
export const FONT =
  '"DejaVu Sans Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

/** One channel of a `#rrggbb` colour. */
function channel(hex: string, index: number): number {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** The colour `t` of the way from `a` to `b`, both `#rrggbb`. */
export function mix(a: string, b: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const parts = [0, 1, 2].map((i) =>
    Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * k),
  );
  return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
}

/**
 * An emitter's drawn colour at heat `h`: a ramp from cold blue through amber and
 * orange to white-hot, so the cold end and the near-redline end read plainly
 * apart (specs/overview.md).
 */
export function heatColor(h: number): string {
  const t = Math.min(1, Math.max(0, h / 100));
  if (t < 0.4) return mix(COLOR.heatCold, COLOR.heatWarm, t / 0.4);
  if (t < 0.75) return mix(COLOR.heatWarm, COLOR.heatHot, (t - 0.4) / 0.35);
  return mix(COLOR.heatHot, COLOR.heatWhite, (t - 0.75) / 0.25);
}

/** A colour at a given alpha, for a wash or a ring. */
export function alpha(hex: string, a: number): string {
  return `rgba(${channel(hex, 0)}, ${channel(hex, 1)}, ${channel(hex, 2)}, ${a})`;
}
