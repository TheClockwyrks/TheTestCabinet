// Fathom — the figures this case's specification fixes. CASE-PROVIDED.
//
// This is the validator's own copy of every number it grades a build by, and it
// is deliberately NOT the build's copy. `specs/overview.md` requires the build to
// write `src/constants.ts`, "holding every figure this specification fixes", so a
// run does have a module of the build's own carrying these names — and a check
// that imported them from there would be asking whether the build agrees with
// itself, which every build does. A build that swims its forager at some other
// speed and writes that speed into its own `FORAGER_SPEED` would pass. So the
// figures live here, on the validator's side of the line, transcribed from the
// seeded specification rather than read back off the thing being measured.
//
// Every value below is stated by that specification, under the name the
// specification uses, so the pairing is checkable by eye: `FORAGER_SPEED` here is
// `specs/movement.md`'s forager speed, and a build that swims at some other speed
// fails the point rather than moving the target.
//
// THIS FILE IS THE PROJECT'S ONLY DOORWAY TO `../src/constants`, and today it
// does not need one: `specs/movement.md` names even the touch layout the build
// registers (`dpad-4-two-buttons`), so there is no figure here the specification
// leaves to the build. Nothing else in this project may import the build's
// module; a suite, `harness.ts` and `surface.ts` all take their figures from
// here. Importing the build's OTHER modules — `../src/game` and the state type it
// exports — is untouched by that: those are the thing under test, not the ruler.
//
// Every position and length is in the fixed 1280x720 logical-unit coordinate
// space `specs/overview.md` defines (origin top-left, x right, y down), every
// rate is per second, and every duration is in seconds.

import type { Dir } from "./maze";

// ---- The stage and the tile grid (specs/overview.md) ----------------------

export const STAGE_W = 1280;
export const STAGE_H = 720;

export const GRID_COLS = 36;
export const GRID_ROWS = 18;
export const TILE = 32;

/** Column 0's left edge and row 0's top edge, in logical units. */
export const GRID_ORIGIN_X = 64;
export const GRID_ORIGIN_Y = 80;

/** The strip specs/ui.md keeps the score and the dive label in: y in [0, 80]. */
export const TOP_STRIP = { y0: 0, y1: GRID_ORIGIN_Y };

/**
 * The strip it keeps the lives, the depth and the two gauges in: y in [656, 720].
 */
export const BOTTOM_STRIP = {
  y0: GRID_ORIGIN_Y + GRID_ROWS * TILE,
  y1: STAGE_H,
};

// ---- The clock (specs/movement.md, specs/instrumentation.md) --------------

/**
 * The simulation's fixed timestep. Unlike a case whose specification leaves the
 * step to the caller, Fathom FIXES it, so the harness clocks its runtime at
 * exactly `TICK_DT` and one advanced frame is one tick: a duration in seconds is
 * a whole number of frames and the suite never chooses a schedule.
 */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;

// ---- The maze (specs/maze.md) --------------------------------------------

/**
 * The bounds on the three corridor proportions, both ends inclusive. Measured
 * over the corridor tiles alone, with the den interior and the den gate excluded
 * from both the tiles measured and the neighbors counted.
 */
export const MAZE_OPENNESS_MIN = 2.0;
export const MAZE_OPENNESS_MAX = 2.8;
export const MAZE_MAZING_MIN = 2.0;
export const MAZE_MAZING_MAX = 8.0;
export const MAZE_DENSITY_MIN = 0.4;
export const MAZE_DENSITY_MAX = 1.0;

/** The rows the forager's start tile is drawn from, both ends in. */
export const START_TILE_ROW_MIN = 9;
export const START_TILE_ROW_MAX = 16;

/** The den chamber's own bounds, all four ends in (specs/maze.md, "The den"). */
export const DEN_COL_MIN = 16;
export const DEN_COL_MAX = 19;
export const DEN_ROW_MIN = 7;
export const DEN_ROW_MAX = 9;

/** The row the one gate tile sits in, directly above the chamber's top row. */
export const DEN_GATE_ROW = 6;

// ---- Movement (specs/movement.md) ----------------------------------------

/** Logical units per second, four tiles per second, constant everywhere. */
export const FORAGER_SPEED = 128;

// ---- Sensing (specs/sensing.md) ------------------------------------------

/** `V = VISION_MIN + VISION_GAIN * G`: 96 at G 0, 160 at G 1. */
export const VISION_MIN = 96;
export const VISION_GAIN = 64;

/**
 * `R = KINDLE_VISION_MIN + KINDLE_VISION_GAIN * G`: the kindle variant's outer
 * vision circle, 192 at G 0 and 320 at G 1. It is a rendering mask that senses
 * nothing. The base variant has no such circle, so no base check reads these.
 */
export const KINDLE_VISION_MIN = 192;
export const KINDLE_VISION_GAIN = 128;

/** Brightness: what one plankton adds, how long it holds, how it decays. */
export const BRIGHT_PER_EAT = 0.34;
export const BRIGHT_HOLD = 1.0;
export const BRIGHT_HALFLIFE = 0.9;

/** The sonar pulse. `E` is a path range in corridor steps, not a radius. */
export const SONAR_COOLDOWN = 1.5;
export const SONAR_RANGE_BASE = 9;
export const SONAR_RANGE_MIN = 5;
export const SONAR_WAVE_SPEED = 14;
export const SONAR_MARK_TIME = 1.5;

/** `E = max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (d - 1))` (specs/progression.md). */
export function sonarRange(depth: number): number {
  return Math.max(SONAR_RANGE_MIN, SONAR_RANGE_BASE - (depth - 1));
}

/** The ink cloud. */
export const INK_COOLDOWN = 8;
export const INK_RADIUS = 80;
export const INK_LIFE = 3;

// ---- What lives in the corridors (specs/gameplay.md) ---------------------

export const DRIFTER_INTERVAL = 25;
export const DRIFTER_MAX = 2;
/** The drifter's speed, and a DISGUISED Lanternjaw's (specs/predators/lanternjaw.md). */
export const DRIFTER_SPEED = 64;

// ---- The predators (specs/predators.md and specs/predators/*.md) ---------

/** Every predator's ordinary travel speed, in logical units per second. */
export const PREDATOR_SPEED = 116;

/** The detection alert window, for the Gloamfin and the Flarefish alone. */
export const ALERT_TIME = 0.5;

/** How long a Lanternjaw or a Flarefish holds a fix after losing the forager. */
export const LINGER_TIME = 2;

/** The staggered den schedule: release times 0 s, 5 s, 10 s, ... in DEN_ORDER. */
export const DEN_RELEASE_GAP = 5;

/** The order the den releases in, which is the order a snapshot lists in. */
export const DEN_ORDER = ["lanternjaw", "gloamfin", "flarefish"] as const;

/** The order deeper mazes add predators in, and where the roster stops. */
export const ROSTER_ADD_ORDER = [
  "gloamfin",
  "lanternjaw",
  "flarefish",
] as const;
export const ROSTER_CAP_DEPTH = 4;
export const ROSTER_CAP = 6;
/** The ceiling per kind, which `ROSTER_CAP` is three of (specs/predators.md). */
export const ROSTER_PER_KIND_CAP = 2;

/** `R = LANTERN_RANGE_BASE + LANTERN_RANGE_GAIN * G`: 128 at G 0, 320 at G 1. */
export const LANTERN_RANGE_BASE = 128;
export const LANTERN_RANGE_GAIN = 192;

/** The Gloamfin's speeds, hearing, ping cadence and search delay. */
export const GLOAMFIN_CHASE_SPEED = 134;
export const GLOAMFIN_CORNER_SPEED = 115;
export const GLOAMFIN_HEAR = 64;
export const GLOAMFIN_PING_INTERVAL = 4;
export const GLOAMFIN_PING_MIN_GAP = 3;
export const GLOAMFIN_PING_RANGE = 9;
export const GLOAMFIN_RAMP_TIME = 2;
export const GLOAMFIN_SEARCH_DELAY = 1.2;

/** The Flarefish's flare: the charge-up, the bloom, the gap, and the disc. */
export const FLARE_CHARGE = 0.5;
export const FLARE_BLOOM = 1;
export const FLARE_INTERVAL = 7;
export const FLARE_RADIUS = 192;

// ---- Scoring, lives and depth (specs/progression.md) ---------------------

export const SCORE_PLANKTON = 10;
export const SCORE_DRIFTER = 200;
export const SCORE_CLEAR = 500;
export const START_LIVES = 3;

/** The seed `reset()` takes when a caller names none. */
export const DEFAULT_SEED = 1;

// ---- The debugging surface (specs/instrumentation.md) --------------------

/** The version the surface reports as `version`. */
export const FATHOM_DEBUG_VERSION = 1;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "FATHOM";
export const TAGLINE_TEXT = "HUNT IN THE DARK";
export const TITLE_ITEMS = ["DIVE", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const GAMEOVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/** The dive label the HUD carries, which is the one thing the variants differ on. */
export const DIVE_LABEL_BASE = "STANDARD";
export const DIVE_LABEL_KINDLE = "KINDLE";

/** Both the countdown and the cleared interstitial hold this long, in seconds. */
export const HOLD_MIN = 1;
export const HOLD_MAX = 3;

// ---- Input (specs/movement.md) -------------------------------------------

/**
 * The touch layout the game registers its actions in the vocabulary of.
 *
 * The engine owns the keyboard here, and `specs/movement.md` fixes the layout by
 * name — "the vocabulary of the `LAYOUT` (`dpad-4-two-buttons`) touch layout the
 * engine is built with" — so this is not a choice the build gets to make and not
 * a value to read back off it. The harness hands it to `createEngine`, and a
 * build that registered some other layout's vocabulary fails where its actions
 * fail to resolve.
 */
export const LAYOUT = "dpad-4-two-buttons";

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values, because a
 * binding is a physical key rather than a layout-dependent character — and
 * because that is the vocabulary a check presses in. The engine resolves an
 * action from these, so what a check dispatches is the key and what it reads is
 * the game acting.
 *
 * `Space` deliberately drives TWO actions, `a` and `confirm`, and `Escape` drives
 * `back` and `pause`; each screen reads the actions in its own row.
 */
export const BINDINGS = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  a: ["Space"],
  b: ["ShiftLeft", "ShiftRight"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
} as const;

/**
 * The arrow key that drives each direction, and its WASD counterpart, split out
 * of `BINDINGS` so a check that is about one of the two binding sets names the
 * set rather than an index into the pair.
 */
export const ARROW_KEY: Readonly<Record<Dir, string>> = {
  up: BINDINGS.up[0],
  down: BINDINGS.down[0],
  left: BINDINGS.left[0],
  right: BINDINGS.right[0],
};

export const WASD_KEY: Readonly<Record<Dir, string>> = {
  up: BINDINGS.up[1],
  down: BINDINGS.down[1],
  left: BINDINGS.left[1],
  right: BINDINGS.right[1],
};

/** The key that shows and hides the debug overlay (specs/instrumentation.md). */
export const OVERLAY_KEY = "Backquote";

// ---- The seven audio cues (specs/progression.md) -------------------------
//
// Under an engine the cues go out on the engine's cue bus, so both halves of
// each row of that file's table are observable and asserted: the property name a
// check writes (`CUES.predatorPing`) and the cue id the engine broadcasts
// (`"predator-ping"`). The specification fixes both — "define exactly the seven
// cues in `CUES` from the game instance's `initialize`" — so they are stated
// here rather than read off the build's own table.

export const CUES = {
  eat: "eat",
  sonar: "sonar",
  ink: "ink",
  predatorPing: "predator-ping",
  flare: "flare",
  caught: "caught",
  descend: "descend",
} as const;
