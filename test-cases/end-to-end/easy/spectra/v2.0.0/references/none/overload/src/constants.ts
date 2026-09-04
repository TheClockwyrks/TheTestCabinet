// Spectra — every figure the specification fixes, named once.
//
// The rule this file exists for: NOTHING ELSE IN THE BUILD WRITES A LITERAL THE
// SPECIFICATION NAMES. A rate, a duration, a footprint, a score, a key code or a
// piece of screen copy is imported from here, so a figure is stated once and the
// specification and the code can be read against each other line for line.
//
// It carries the four STAGE FORMULAS as functions rather than as constants,
// because each is a function of the stage and a flat figure would be the stage-1
// value pretending to be the whole rule (specs/stages.md).
//
// What is deliberately NOT here: colours, fonts, and every layout figure past
// the geometry the specification fixes. Those are the build's own choices and
// they live in `src/theme.ts`.

import type { Band, DroneKind } from "./types";

// --- The stage and its three regions (specs/field.md) -----------------------

/** The logical stage width; the game draws in `0..STAGE_W`. */
export const STAGE_W = 1280;
/** The logical stage height; the game draws in `0..STAGE_H`. */
export const STAGE_H = 720;

/** The top HUD strip runs from `y` 0 to here. */
export const HUD_TOP_H = 64;
/** The play field's top edge. */
export const FIELD_TOP = 64;
/** The play field's bottom edge. */
export const FIELD_BOTTOM = 656;
/** The bottom HUD strip's top edge. */
export const HUD_BOTTOM_TOP = 656;
/** The play field's left edge. */
export const FIELD_LEFT = 0;
/** The play field's right edge. */
export const FIELD_RIGHT = 1280;

/** The fewest marks the starfield behind the play field holds. */
export const STARFIELD_MIN = 40;

// --- The frame (specs/simulation.md) ----------------------------------------

/** The furthest a single sub-step may carry anything, in seconds. */
export const SUBSTEP_MAX = 1 / 120;

// --- The ship (specs/ship.md, specs/field.md) -------------------------------

/** The ship's centre `y`, fixed for the whole run. */
export const SHIP_Y = 600;
/** The ship's drawn width. */
export const SHIP_W = 40;
/** The ship's drawn height. */
export const SHIP_H = 28;
/** The ship's contact half-extent. */
export const SHIP_HALF = 15;
/** The left bound of the ship's lane, as a centre `x`. */
export const SHIP_X_MIN = 40;
/** The right bound of the ship's lane, as a centre `x`. */
export const SHIP_X_MAX = 1240;
/** How fast the ship travels along its lane, in units per second. */
export const SHIP_SPEED = 360;

// --- Firing (specs/ship.md, specs/bands.md) ---------------------------------

/** How fast one of the player's bullets climbs, in units per second. */
export const PLAYER_BULLET_SPEED = 760;
/** A player bullet's drawn width. */
export const PLAYER_BULLET_W = 4;
/** A player bullet's drawn height. */
export const PLAYER_BULLET_H = 16;
/** A player bullet's contact half-extent. */
export const PLAYER_BULLET_HALF = 6;
/** The cadence a held fire action repeats at, in seconds. */
export const FIRE_INTERVAL = 0.16;
/** How many of the player's bullets may be in flight at once. */
export const MAX_PLAYER_BULLETS = 3;
/** The fire lockout a flip starts, in seconds. */
export const FLIP_LOCKOUT = 0.3;

// --- Enemy fire (specs/swarm.md) --------------------------------------------

/** How fast an enemy bullet falls at stage 1, in units per second. */
export const ENEMY_BULLET_SPEED = 320;
/** An enemy bullet's drawn width. */
export const ENEMY_BULLET_W = 6;
/** An enemy bullet's drawn height. */
export const ENEMY_BULLET_H = 12;
/** An enemy bullet's contact half-extent. */
export const ENEMY_BULLET_HALF = 8;

// --- The formation grid and its sway (specs/field.md) -----------------------

/** The horizontal spacing between two formation slots. */
export const SLOT_DX = 64;
/** The vertical spacing between two formation slots. */
export const SLOT_DY = 48;
/** How many columns the slot grid holds. */
export const FORM_COLS = 9;
/** How many rows the slot grid holds. */
export const FORM_ROWS = 5;
/** The `x` the slot grid is centred on. */
export const FORM_CENTER_X = 640;
/** The `y` of the grid's top row. */
export const FORM_ROW0_Y = 140;
/** How far the whole formation swings either side of its slots. */
export const SWAY_AMP = 20;
/** How long one full swing of the formation takes, in seconds. */
export const SWAY_PERIOD = 5;

/** The centre `x` of the slot in column `col`, before the sway. */
export function slotX(col: number): number {
  return FORM_CENTER_X + SLOT_DX * (col - (FORM_COLS - 1) / 2);
}

/** The centre `y` of the slot in row `row`. */
export function slotY(row: number): number {
  return FORM_ROW0_Y + SLOT_DY * row;
}

/** The whole formation's horizontal offset at `t` seconds into the wave. */
export function swayOffset(t: number): number {
  return SWAY_AMP * Math.sin((2 * Math.PI * t) / SWAY_PERIOD);
}

// --- The three drones (specs/drones.md, specs/swarm.md) ---------------------

/** A Shard's drawn footprint. */
export const SHARD_SIZE = 28;
/** A Flux's drawn footprint. */
export const FLUX_SIZE = 30;
/** A Prism's drawn footprint while its shell stands. */
export const PRISM_SIZE = 56;
/** A Prism's drawn footprint once only its core is left. */
export const PRISM_CORE_SIZE = 26;
/** A Shard's contact half-extent. */
export const SHARD_HALF = 14;
/** A Flux's contact half-extent. */
export const FLUX_HALF = 15;
/** A Prism's contact half-extent while its shell stands. */
export const PRISM_HALF = 28;
/** A Prism's contact half-extent once only its core is left. */
export const PRISM_CORE_HALF = 13;

/** How fast a drone flies its entrance at stage 1, in units per second. */
export const ENTER_SPEED = 260;
/** The gap between two entry groups being released, in seconds. */
export const ENTER_GROUP_GAP = 0.6;
/** How fast a drone flies its dive at stage 1, in units per second. */
export const DIVE_SPEED = 300;
/** How long a wave waits before its first dive, in seconds. */
export const DIVE_FIRST_DELAY = 2;
/** The shortest gap between two later dives, in seconds, before scaling. */
export const DIVE_GAP_MIN = 1.4;
/** The longest gap between two later dives, in seconds, before scaling. */
export const DIVE_GAP_MAX = 2.6;
/** The `y` a diver takes its first shot as it crosses, travelling downward. */
export const DIVE_FIRE_Y = 360;

/** The held part of a Flux's band window at stage 1, in seconds. */
export const FLUX_HOLD_L1 = 1.6;
/** How long a Flux's shimmer lasts, in seconds. */
export const FLUX_SHIMMER = 0.4;

/** How many Shards fly in alongside a Prism. */
export const PRISM_ESCORTS = 2;
/** The `y` a diving Prism triggers a spectral inversion as it crosses. */
export const PRISM_INVERT_Y = 640;

/** The three drone kinds, in the order the specification names them. */
export const DRONE_KINDS: readonly DroneKind[] = ["shard", "flux", "prism"];

/** The drawn footprint of `kind`, given whether a Prism's shell stands. */
export function droneSize(kind: DroneKind, shellAlive: boolean): number {
  if (kind === "shard") return SHARD_SIZE;
  if (kind === "flux") return FLUX_SIZE;
  return shellAlive ? PRISM_SIZE : PRISM_CORE_SIZE;
}

/** The contact half-extent of `kind`, given whether a Prism's shell stands. */
export function droneHalf(kind: DroneKind, shellAlive: boolean): number {
  if (kind === "shard") return SHARD_HALF;
  if (kind === "flux") return FLUX_HALF;
  return shellAlive ? PRISM_HALF : PRISM_CORE_HALF;
}

// --- The bands and the inversion (specs/bands.md) ---------------------------

/** The cyan band. */
export const CYAN: Band = "cyan";
/** The magenta band. */
export const MAGENTA: Band = "magenta";

/** The other band. */
export function opposite(band: Band): Band {
  return band === CYAN ? MAGENTA : CYAN;
}

/** How long a spectral inversion lasts, in seconds. */
export const INVERSION_TIME = 5;

// --- Resonance and the discharge (specs/resonance.md) -----------------------

/** A full resonance meter. */
export const RESONANCE_MAX = 100;
/** What absorbing a same-band enemy bullet adds to the meter. */
export const RESONANCE_ABSORB = 6;
/** What a matching kill adds to the meter. */
export const RESONANCE_KILL = 4;
/** How long a discharge wave is live, in seconds. */
export const DISCHARGE_TIME = 0.5;
/** The radius a discharge wave grows to over its life. */
export const DISCHARGE_MAX_R = 1500;

// --- Stages and their scaling (specs/stages.md) -----------------------------

/** Every stage divisible by this is a challenge stage. */
export const CHALLENGE_EVERY = 3;
/** How many groups a challenge stage sends in. */
export const CHALLENGE_GROUPS = 5;
/** How many drones one challenge group holds. */
export const CHALLENGE_PER_GROUP = 8;
/** How many drones a whole challenge stage holds. */
export const CHALLENGE_TOTAL = 40;

/** Whether `stage` is a challenge stage rather than a standard wave. */
export function isChallengeStage(stage: number): boolean {
  return stage % CHALLENGE_EVERY === 0;
}

/** What `stage` multiplies the entrance and dive speeds by. */
export function droneSpeedScale(stage: number): number {
  return Math.min(1.5, 1 + 0.06 * (stage - 1));
}

/** What `stage` multiplies the enemy bullet speed by. */
export function bulletSpeedScale(stage: number): number {
  return Math.min(1.4, 1 + 0.04 * (stage - 1));
}

/** What `stage` multiplies the gap between dive launches by. */
export function diveGapScale(stage: number): number {
  return Math.max(0.55, 1 - 0.05 * (stage - 1));
}

/** The held part of a Flux's band window at `stage`, in seconds. */
export function fluxHold(stage: number): number {
  return Math.max(1, FLUX_HOLD_L1 - 0.05 * (stage - 1));
}

/** A whole band window at `stage`: the hold plus the shimmer, in seconds. */
export function fluxWindow(stage: number): number {
  return fluxHold(stage) + FLUX_SHIMMER;
}

/** A full cycle back to the same stored band at `stage`, in seconds. */
export function fluxCycle(stage: number): number {
  return 2 * fluxWindow(stage);
}

// --- The run (specs/progression.md, specs/ui.md) ----------------------------

/** How many lives a run starts with. */
export const START_LIVES = 3;
/** The score the run's one extra life is paid at. */
export const EXTRA_LIFE_AT = 20000;
/** How long the `ready` phase holds after a life is lost, in seconds. */
export const READY_HOLD = 1.3;
/** How long the stage-intro hold lasts, in seconds. */
export const STAGE_INTRO_HOLD = 2;
/** How long the stage-cleared interstitial lasts, in seconds. */
export const STAGE_CLEARED_HOLD = 2.6;

// --- Scoring (specs/scoring.md) ---------------------------------------------

/** What a Shard destroyed in phase `formation` pays. */
export const SCORE_SHARD_FORM = 50;
/** What a Shard destroyed in any other phase pays. */
export const SCORE_SHARD_DIVE = 100;
/** What a Flux destroyed in phase `formation` pays. */
export const SCORE_FLUX_FORM = 80;
/** What a Flux destroyed in any other phase pays. */
export const SCORE_FLUX_DIVE = 160;
/** What a Prism's shell pays, in any phase. */
export const SCORE_PRISM_SHELL = 100;
/** What a Prism's exposed core pays, in any phase. */
export const SCORE_PRISM_CORE = 400;
/** What one drone of a challenge stage pays. */
export const SCORE_CHALLENGE_DRONE = 100;
/** What clearing a standard stage pays. */
export const SCORE_STAGE_CLEAR = 1000;
/** What a challenge stage with every drone destroyed pays. */
export const SCORE_PERFECT_BONUS = 10000;

// --- The seeded art (specs/assets.md) ---------------------------------------

/** The square canvas every seeded sprite is drawn on. */
export const SPRITE_SIZE = 64;

/** The four seeded sprites, by the element each depicts. */
export const SPRITES = {
  fighter: "fighter.png",
  shard: "shard.png",
  flux: "flux.png",
  prism: "prism.png",
} as const;

/** The seeded particle system a destroyed drone pops with. */
export const BURST_SYSTEM = "drone-burst.json";
/** The square field the burst is authored on. */
export const BURST_FIELD = 128;
/** How long one burst plays, in seconds. */
export const BURST_DURATION = 0.7;
/** How many bursts may play at once. */
export const MAX_BURSTS = 24;

// --- Screen copy (specs/ui.md, specs/mode.md) ------------------------------

/** The game's name, on the title screen. */
export const TITLE_TEXT = "SPECTRA";
/** The tagline under it. */
export const TAGLINE_TEXT = "TUNE TO SURVIVE";
/** The title menu, in order. The first item opens the mode this build ships. */
export const TITLE_ITEMS = ["OVERLOAD", "HOW TO PLAY"] as const;
/** The pause menu, in order. */
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
/** The game-over menu, in order. */
export const GAME_OVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;
/** The label the stage readout and the stage intro both carry. */
export const HUD_STAGE_LABEL = "STAGE";
/** What a challenge stage's intro announces itself with. */
export const CHALLENGE_BANNER = "CHALLENGING STAGE";
/** What the `ready` phase draws over the field. */
export const READY_TEXT = "READY";
/** What a challenge stage with every drone destroyed reports. */
export const PERFECT_TEXT = "PERFECT!";
/** The two bands, as a player reads them. */
export const BAND_LABELS: Readonly<Record<Band, string>> = {
  cyan: "CYAN",
  magenta: "MAGENTA",
};

// --- The debug and automation surface (specs/instrumentation.md) ------------

/** The version the surface reports. */
export const SPECTRA_DEBUG_VERSION = 1;
/** The seed `reset()` uses when it is given none. */
export const DEFAULT_SEED = 1;
/** The `KeyboardEvent.code` that shows and hides the debug overlay. */
export const OVERLAY_KEY = "Backquote";
/** The `window` property the surface is installed on. */
export const SPECTRA_HANDLE = "__spectra";

// --- Overload, the mode this build ships (specs/mode.md) --------------------

/** The charge a drone overloads at. */
export const OVERLOAD_AT = 3;
/** What an overloaded Shard multiplies its dive speed by. */
export const OVERLOAD_DIVE_SCALE = 1.6;
/** How many enemy bullets an overloaded Flux sprays. */
export const OVERLOAD_FLUX_SPREAD = 3;
/** How far apart, in degrees, the headings of that spray sit. */
export const OVERLOAD_FLUX_SPREAD_ANGLE = 20;
/** How many Shards an overloaded Prism shell adds beside it. */
export const OVERLOAD_PRISM_ESCORTS = 1;

// --- The keyboard (specs/controls.md) --------------------------------------

/** Every action the game answers to. */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "discharge",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

/** One of {@link ACTIONS}. */
export type ActionName = (typeof ACTIONS)[number];

/**
 * The `KeyboardEvent.code` values that drive each action.
 *
 * Several keys deliberately drive more than one action — `Space` drives `a` and
 * `confirm`, `ArrowUp` and `KeyW` drive `a` and `up`, `Escape` drives `back` and
 * `pause` — and the screen decides which one applies, by
 * `specs/controls.md`'s table (see `src/screens.ts`).
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  a: ["Space", "ArrowUp", "KeyW"],
  b: ["KeyF", "ShiftLeft", "ShiftRight"],
  discharge: ["KeyX"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
};

// --- Audio (specs/ui.md, specs/mode.md) ------------------------------------

/**
 * The ten cues, one per event: the nine `specs/ui.md` names and the tenth this
 * mode adds.
 */
export const CUES = {
  fire: "fire",
  flip: "flip",
  absorb: "absorb",
  kill: "kill",
  discharge: "discharge",
  inversion: "inversion",
  hit: "hit",
  stageClear: "stage-clear",
  menu: "menu",
  overload: "overload",
} as const;

/** One of {@link CUES}. */
export type CueName = (typeof CUES)[keyof typeof CUES];
