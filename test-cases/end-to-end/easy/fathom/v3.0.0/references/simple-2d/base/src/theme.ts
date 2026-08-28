// Fathom — this build's look: the palette, the type, and where the HUD sits.
//
// None of this is fixed by the specification. `specs/overview.md` states what a
// player has to be able to read at a glance — flat darkness over an unrevealed
// tile, rock told from water, the forager apart from its corridor, three
// distinguishable hunters, two amber lights that read alike, three sonar tints —
// and leaves the palette, the type and the composition to the build. So every
// figure here is this build's own choice and lives apart from the case-fixed
// `src/constants.ts`, which deliberately carries no color at all.
//
// The look is bioluminescence in the abyss: cold light glowing out of a
// near-black trench, with the two amber lights the one warm thing in it.

import { GRID_ORIGIN_Y, STAGE_H, STAGE_W } from "./constants";

/** Cold light on near-black water. */
export const COLOR = {
  /** The water the stage and its letterbox bars are cleared to. */
  bg: "#03060c",
  /** Unrevealed ground, drawn where a tile has never been touched by light. */
  fog: "#03060c",
  /** The corridor floor and the trench rock, for a frame that failed to load. */
  floor: "#0a1422",
  rock: "#12283c",
  rockRim: "#22506f",
  gate: "#2c5878",
  /** The forager and its light. */
  forager: "#46f0e0",
  foragerGlow: "70,240,224",
  /** A plankton mote. */
  plankton: "#b8f5c8",
  /** The two amber lights: the bonus drifter and the Lanternjaw's bulb. */
  amber: "255,209,102",
  amberCore: "#fff3cf",
  /** Each hunter's own color, which its alert flash is drawn in. */
  gloamfin: "#a98bff",
  flarefish: "#ff8a4c",
  /** An ink cloud. */
  ink: "11,10,31",
  text: "#e6f2f7",
  textDim: "#8fa6b8",
  textFaint: "#4d6274",
  panel: "#070d17",
  panelBorder: "#1b2e44",
} as const;

/** The three sonar tints `specs/state.md` names, as `r,g,b` triples. */
export const SONAR_RGB: Readonly<Record<"cyan" | "violet" | "orange", string>> =
  {
    cyan: "94,242,255",
    violet: "169,139,255",
    orange: "255,164,74",
  };

/**
 * A system monospace stack. Nothing is downloaded, so the game renders the same
 * with no network (`specs/overview.md`).
 */
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- The fog of war ------------------------------------------------------

/** How much of its full brightness a remembered tile keeps. */
export const REMEMBERED_ALPHA = 0.55;

/** How far past the light radius the forager's glow is painted. */
export const POCKET_SCALE = 1.35;

// ---- Sprite animation ----------------------------------------------------

/** Frames a second for each swim cycle, inside the bands `specs/assets.md` gives. */
export const FORAGER_FPS = 9;
export const HUNT_FPS = 7;
export const SWAY_FPS = 8;

// ---- The sonar crest -----------------------------------------------------

/** How many corridor steps behind the front the crest is still drawn. */
export const SONAR_BAND = 1.6;
/** The radius of curvature and half-angle of one tile's crest arc. */
export const SONAR_ARC_R = 20;
export const SONAR_ARC_SPREAD = 1.15;

// ---- The HUD -------------------------------------------------------------

/** The strip above the maze region, and the strip below it. */
export const HUD_TOP_H = GRID_ORIGIN_Y;
export const HUD_BOT_Y = STAGE_H - 64;

export const HUD_MARGIN = 40;
export const SCORE_FONT_PX = 48;
export const SCORE_DIGITS = 5;
export const LIVES_ICON = 20;
export const LIVES_GAP = 26;
export const GAUGE_W = 88;

/** Where each gauge's label starts, on the bottom strip. */
export const SONAR_GAUGE_X = STAGE_W / 2 - 150;
export const INK_GAUGE_X = STAGE_W / 2 + 20;
