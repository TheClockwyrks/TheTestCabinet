// Floe — this build's look.
//
// The specification leaves the palette, the typography, the HUD's arrangement and
// the sprite animation rates to the build (specs/overview.md), so NONE of this is
// a spec figure: everything the specification does fix lives in
// `src/constants.ts`. What is here is one cold-Arctic theme, named once so the
// renderer, the page and the runtime agree on it.
//
// The one property the specification does ask of the look is that a player reads
// the five bands, the deep water, the bays, the critter, the bear, the vehicles
// and every piece of text at a glance. The palette below is chosen for that: each
// band's tint is far from every other band's, and the seeded art — an orange
// critter, a white bear, a grey-blue swimming bear — sits well clear of whatever
// it is drawn over.

/** The palette. */
export const COLOR = {
  /** The stage background, which the runtime also clears the letterbox bars to. */
  background: "#061019",

  /** The HUD bar, and every panel laid over the strait. */
  panel: "#061019",
  panelEdge: "#1d3a4d",

  /** The far shore: bright, hard pack ice. */
  farShore: "#e8f4fa",
  farShoreEdge: "#b9d6e4",
  /** Deep water between the floes. */
  water: "#0d2f4a",
  waterDeep: "#092338",
  /** The median shelf: a colder, bluer sheet than the near shore. */
  median: "#96c4d6",
  /** The ice band the traffic runs on: scoured, grey-blue. */
  iceBand: "#6f8fa3",
  iceBandLine: "rgba(232, 244, 250, 0.06)",
  /** The near shore: wind-blown snow over tundra. */
  nearShore: "#cebe96",

  /** A bay standing open: a dark inlet cut into the shore. */
  bayOpen: "#10496e",
  /** A bay a crossing has ended in. */
  bayFilled: "#f0a63c",
  /** The bonus catch. */
  fish: "#7ff0d8",

  /** Text. */
  text: "#eaf6fb",
  textDim: "#8fb6c9",
  /** The highlighted item of a menu. */
  highlight: "#ffd166",

  /** A splash of water, and the spray a plow throws. */
  splash: "#cfe6f2",
  spray: "#ffd9c2",
} as const;

/**
 * A system stack with no downloaded web font, so the game renders identically
 * offline and at any base path.
 */
export const UI_FONT =
  '"DejaVu Sans", "Liberation Sans", "Helvetica Neue", Arial, sans-serif';

/** The same idea for figures, where even digit widths keep a readout from jittering. */
export const MONO_FONT =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- The HUD's own arrangement ------------------------------------------

/** Where each readout's text begins, and the baseline they share. */
export const HUD = {
  /** The baseline the four text readouts sit on. */
  textY: 30,
  /** The size the readouts are set at. */
  fontPx: 20,
  scoreX: 24,
  livesX: 330,
  levelX: 560,
  timerX: 1256,
  /** The bay marks' vertical band inside the HUD bar. */
  bayY: 50,
  bayH: 14,
  bayW: 30,
} as const;

// ---- Animation ----------------------------------------------------------
//
// A frame rate is appearance rather than a rule, so these are the build's
// (specs/assets.md: "alternate them ... at a rate that reads as motion. The rate
// is yours.").

/** Alternations a second of the critter's two-frame pair. */
export const CROSSER_FPS = 6;
/** Alternations a second of a bear's run pair. */
export const BEAR_RUN_FPS = 8;
/** Alternations a second of a bear's swim pair. */
export const BEAR_SWIM_FPS = 5;
/** Alternations a second of the lunge pair. */
export const BEAR_LUNGE_FPS = 10;
