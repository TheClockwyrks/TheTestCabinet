// Shatter — this build's look.
//
// `specs/overview.md` fixes what a player must be able to READ at a glance —
// the ship apart from the field and from every other body, its facing legible,
// the star as a bright core inside a halo that fades outward, a bullet's tail,
// the thrust flame, the respawn grace, the HUD — and then leaves the palette,
// the type and the composition to the build. This file is that choice, kept
// away from `src/constants.ts`, which carries only figures the specification
// fixes.
//
// The one requirement the field itself carries is that it is DARK: sampled
// clear of every body, the background's luminance is below a quarter of full.
// `BACKGROUND` below is `#05070f`, whose relative luminance is under three per
// cent, so the halo, the trails and the HUD all read against it.
//
// The palette is chosen so the six bodies are far apart in RGB as well as in
// shape: a cold white-cyan ship, warm grey rocks, a magenta saucer, amber
// bullets, red saucer fire, and a pale-gold star.

/** The field's background, and the color the engine clears the canvas to. */
export const BACKGROUND = "#05070f";

/** Every color this build draws with. */
export const COLOR = {
  background: BACKGROUND,
  /** The ship's hull and its outline. */
  ship: "#9fe8ff",
  shipFill: "#0d2a44",
  /** The nose marker that makes the facing legible at a glance. */
  shipNose: "#ffffff",
  /** The thrust flame. */
  flame: "#ff9d3c",
  flameCore: "#ffe9b0",
  /** A rock's face and its rim. */
  rock: "#9c8f86",
  rockRim: "#d8ccc0",
  rockShade: "#5d544d",
  /** The enemy saucer. */
  saucer: "#ff6ec7",
  saucerDome: "#ffd2f0",
  /** The ship's bullets and their tails. */
  bullet: "#ffe066",
  /** The saucer's bullets. */
  enemyBullet: "#ff5f5f",
  /** The star: a bright core inside a halo that fades outward. */
  core: "#fff2c4",
  coreEdge: "#ffc65a",
  halo: "#ffab3d",
  /** Text and the HUD. */
  text: "#dfe9ff",
  textDim: "#7d8ba8",
  accent: "#63f0d6",
} as const;

/** The one type face this build draws in. */
const FONT_FAMILY =
  '"Bahnschrift", "Segoe UI", "Helvetica Neue", system-ui, sans-serif';

/** A canvas font string at a size and weight. */
export function font(size: number, weight = 600): string {
  return `${weight} ${size}px ${FONT_FAMILY}`;
}

/** The `[r, g, b]` of a six-digit hex color, for tests that read pixels. */
export function rgbOf(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** The same color at an alpha, as an `rgba()` string. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- The composition ------------------------------------------------------

/** The HUD sits in the top-left corner, clear of the field's centre. */
export const HUD = {
  x: 34,
  scoreY: 46,
  scoreSize: 38,
  glyphY: 76,
  glyphGap: 24,
  glyphScale: 0.62,
} as const;

/** How long the extra-ship notice stays on the field, in seconds. */
export const EXTRA_LIFE_NOTICE = 1.5;

/** The respawn grace blinks at this period, in seconds, half on and half off. */
export const BLINK_PERIOD = 0.18;
