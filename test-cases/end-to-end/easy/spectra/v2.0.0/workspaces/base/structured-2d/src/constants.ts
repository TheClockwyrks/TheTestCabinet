// Spectra — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down), and every position the
// game reports is a CENTER. That space is the engine's logical design size: the
// engine scales and letterboxes it onto the canvas, and the game leaves the camera
// at rest, so world units and these logical units coincide, no value here is ever
// expressed in real pixels, and gameplay never leaves logical space.
//
// Every rate below is PER SECOND and is integrated against the delta time the
// frame hands the game. There is no fixed timestep: `SUBSTEP_MAX` is a ceiling on
// how far a sub-step may carry anything, not a rate the game is clocked at, and
// `specs/simulation.md` states how a frame is divided by it.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Spectra fixes no palette, no font,
// no HUD layout and no background. There is not a single colour or type face in
// this file, and there is not meant to be one. The seeded art under `assets/`
// already carries the two band colours, and `specs/overview.md`'s legibility table
// states what a player must be able to read at a glance — the two bands apart from
// each other and from the field, a Flux's shimmer, a Prism's layers, a bullet's
// band — while leaving every value behind those readings to the build. The one
// colour the project carries is `BACKGROUND`, which the build exports from
// `src/game.ts` because the build chooses it.

// ---- Stage (specs/overview.md) -------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

// ---- Field geometry (specs/field.md) -------------------------------------

/** The top HUD strip spans the full width: `y` in `[0, HUD_TOP_H]`. */
export const HUD_TOP_H = 64;

/** The play field, between the two strips: `y` in `[FIELD_TOP, FIELD_BOTTOM]`. */
export const FIELD_TOP = 64;
export const FIELD_BOTTOM = 656;

/** The bottom HUD strip: `y` in `[HUD_BOTTOM_TOP, STAGE_H]`. */
export const HUD_BOTTOM_TOP = 656;

/** The play field spans the full width. */
export const FIELD_LEFT = 0;
export const FIELD_RIGHT = 1280;

/** How many marks the starfield behind the play field carries, at least. */
export const STARFIELD_MIN = 40;

// ---- Simulation (specs/simulation.md) ------------------------------------

/**
 * The furthest a single sub-step may carry anything. A frame is divided into
 * `n = max(1, ceil(dt / SUBSTEP_MAX))` sub-steps of `h = dt / n`, so one second of
 * game time covers the same ground whether it arrived as one frame, sixty, or a
 * hundred and twenty. This is a ceiling, not a clock.
 */
export const SUBSTEP_MAX = 1 / 120;

// ---- The ship (specs/field.md, specs/ship.md) ----------------------------

/** The ship's lane: a fixed centre `y`, and the bounds its centre clamps to. */
export const SHIP_Y = 600;
export const SHIP_X_MIN = 40;
export const SHIP_X_MAX = 1240;

/** The ship's drawn footprint, and the half-extent a contact is decided by. */
export const SHIP_W = 40;
export const SHIP_H = 28;
export const SHIP_HALF = 15;

/** How fast the ship travels while a direction is held. */
export const SHIP_SPEED = 360;

// ---- Firing (specs/ship.md) ----------------------------------------------

/** A player bullet: how fast it climbs, how it is drawn, and its half-extent. */
export const PLAYER_BULLET_SPEED = 760;
export const PLAYER_BULLET_W = 4;
export const PLAYER_BULLET_H = 16;
export const PLAYER_BULLET_HALF = 6;

/** The cannon's cadence and how many of its shots may be alive at once. */
export const FIRE_INTERVAL = 0.16;
export const MAX_PLAYER_BULLETS = 3;

/** How long firing is locked out after the ship flips its band. */
export const FLIP_LOCKOUT = 0.3;

// ---- Enemy fire (specs/swarm.md) -----------------------------------------

/** An enemy bullet: its stage-1 fall speed, how it is drawn, and its half-extent. */
export const ENEMY_BULLET_SPEED = 320;
export const ENEMY_BULLET_W = 6;
export const ENEMY_BULLET_H = 12;
export const ENEMY_BULLET_HALF = 8;

// ---- The formation (specs/field.md) --------------------------------------

/** The slot grid the assembled swarm holds: `FORM_COLS` across by `FORM_ROWS` down. */
export const SLOT_DX = 64;
export const SLOT_DY = 48;
export const FORM_COLS = 9;
export const FORM_ROWS = 5;

/** The grid is centred on `FORM_CENTER_X`, with its top row at `FORM_ROW0_Y`. */
export const FORM_CENTER_X = 640;
export const FORM_ROW0_Y = 140;

/** The sway: the whole block translates by `swayOffset(t)`, and nothing else moves. */
export const SWAY_AMP = 20;
export const SWAY_PERIOD = 5;

/** The centre of the slot in column `col` (0..FORM_COLS-1), before the sway. */
export function slotX(col: number): number {
  return FORM_CENTER_X + SLOT_DX * (col - (FORM_COLS - 1) / 2);
}

/** The centre of the slot in row `row` (0..FORM_ROWS-1). */
export function slotY(row: number): number {
  return FORM_ROW0_Y + SLOT_DY * row;
}

/** The sway offset the whole formation carries at game time `t`, in x. */
export function swayOffset(t: number): number {
  return SWAY_AMP * Math.sin((2 * Math.PI * t) / SWAY_PERIOD);
}

// ---- The drones (specs/drones.md, specs/swarm.md) ------------------------

/** Each kind's drawn footprint, and the half-extent a contact is decided by. */
export const SHARD_SIZE = 28;
export const SHARD_HALF = 14;
export const FLUX_SIZE = 30;
export const FLUX_HALF = 15;
export const PRISM_SIZE = 56;
export const PRISM_HALF = 28;
export const PRISM_CORE_SIZE = 26;
export const PRISM_CORE_HALF = 13;

/** The entrance: its stage-1 speed, and the gap between successive groups. */
export const ENTER_SPEED = 260;
export const ENTER_GROUP_GAP = 0.6;

/**
 * The dive: its stage-1 speed, the wave's dive clock reaching `DIVE_FIRST_DELAY`
 * for the first launch and a value in `[DIVE_GAP_MIN, DIVE_GAP_MAX]` scaled by
 * `diveGapScale(stage)` for each later one, and the line a diver first fires as
 * its centre crosses.
 */
export const DIVE_SPEED = 300;
export const DIVE_FIRST_DELAY = 2.0;
export const DIVE_GAP_MIN = 1.4;
export const DIVE_GAP_MAX = 2.6;
export const DIVE_FIRE_Y = 360;

/**
 * The Flux's rhythm: its stage-1 hold, and the shimmer that ends every window.
 * The stage-1 name is deliberate — `fluxHold(stage)` below is what a caller reads,
 * because the hold shortens with the stage and a flat figure would be the stage-1
 * value pretending to be the rule.
 */
export const FLUX_HOLD_L1 = 1.6;
export const FLUX_SHIMMER = 0.4;

/** The Prism: how many Shards escort it in, and the line a diving one inverts at. */
export const PRISM_ESCORTS = 2;
export const PRISM_INVERT_Y = 640;

// ---- The bands and the inversion (specs/bands.md) ------------------------

/** How long a spectral inversion holds the two bands swapped. */
export const INVERSION_TIME = 5.0;

// ---- Resonance and the discharge (specs/resonance.md) --------------------

/** The meter's ceiling, and what each event adds to it. */
export const RESONANCE_MAX = 100;
export const RESONANCE_ABSORB = 6;
export const RESONANCE_KILL = 4;

/** The discharge wave: how long it runs, and the radius that covers the stage. */
export const DISCHARGE_TIME = 0.5;
export const DISCHARGE_MAX_R = 1500;

// ---- Stages (specs/stages.md) --------------------------------------------

/** Every third stage is a challenge stage, of `CHALLENGE_GROUPS` groups. */
export const CHALLENGE_EVERY = 3;
export const CHALLENGE_GROUPS = 5;
export const CHALLENGE_PER_GROUP = 8;
export const CHALLENGE_TOTAL = CHALLENGE_GROUPS * CHALLENGE_PER_GROUP;

/** Whether `stage` is a challenge stage rather than a standard wave. */
export function isChallengeStage(stage: number): boolean {
  return stage % CHALLENGE_EVERY === 0;
}

/** How much faster drones travel at `stage`, capped. A challenge stage does not scale. */
export function droneSpeedScale(stage: number): number {
  return Math.min(1.5, 1 + 0.06 * (stage - 1));
}

/** How much faster enemy fire falls at `stage`, capped. */
export function bulletSpeedScale(stage: number): number {
  return Math.min(1.4, 1 + 0.04 * (stage - 1));
}

/** How much tighter the gap between dive launches is at `stage`, floored. */
export function diveGapScale(stage: number): number {
  return Math.max(0.55, 1 - 0.05 * (stage - 1));
}

/** How long a Flux holds a band at `stage`, floored. */
export function fluxHold(stage: number): number {
  return Math.max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1));
}

/**
 * One band window at `stage`: the hold plus the shimmer that ends it. This is the
 * domain of a Flux's band clock, and the whole reason the two functions below are
 * stage formulas rather than flat figures.
 */
export function fluxWindow(stage: number): number {
  return fluxHold(stage) + FLUX_SHIMMER;
}

/** A full cycle back to the same band at `stage`: two windows. */
export function fluxCycle(stage: number): number {
  return 2 * fluxWindow(stage);
}

// ---- The run (specs/progression.md, specs/ui.md) -------------------------

/** How many lives a run starts with, and the score that pays one more. */
export const START_LIVES = 3;
export const EXTRA_LIFE_AT = 20000;

/** The three holds a run passes through. */
export const READY_HOLD = 1.3;
export const STAGE_INTRO_HOLD = 2.0;
export const STAGE_CLEARED_HOLD = 2.6;

// ---- Scoring (specs/scoring.md) ------------------------------------------

export const SCORE_SHARD_FORM = 50;
export const SCORE_SHARD_DIVE = 100;
export const SCORE_FLUX_FORM = 80;
export const SCORE_FLUX_DIVE = 160;
export const SCORE_PRISM_SHELL = 100;
export const SCORE_PRISM_CORE = 400;
export const SCORE_CHALLENGE_DRONE = 100;
export const SCORE_PERFECT_BONUS = 10000;
export const SCORE_STAGE_CLEAR = 1000;

// ---- The seeded art and effect (specs/assets.md) -------------------------

/** Every PNG under `assets/` is drawn on this square canvas, with straight alpha. */
export const SPRITE_SIZE = 64;

/** The four seeded silhouettes, by the name each is drawn for. */
export const SPRITES = {
  fighter: "fighter.png",
  shard: "shard.png",
  flux: "flux.png",
  prism: "prism.png",
} as const;

/** The seeded particle system a destroyed drone pops with. */
export const BURST_SYSTEM = "drone-burst.json";

/** The burst: the square it simulates in, how long it plays, and how many may play. */
export const BURST_FIELD = 128;
export const BURST_DURATION = 0.7;
export const MAX_BURSTS = 24;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "SPECTRA";
export const TAGLINE_TEXT = "TUNE TO SURVIVE";

export const TITLE_ITEMS = ["LAUNCH", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const GAME_OVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/**
 * The copy the specification fixes. How each is composed into a strip or a banner —
 * the label above the digits, the slash, the spacing — is the build's.
 */
export const HUD_STAGE_LABEL = "STAGE";
export const CHALLENGE_BANNER = "CHALLENGING STAGE";
export const READY_TEXT = "READY";
export const PERFECT_TEXT = "PERFECT!";

/** What each band is called wherever the game names one in words. */
export const BAND_LABELS = { cyan: "CYAN", magenta: "MAGENTA" } as const;

// ---- The debug surface (specs/instrumentation.md) ------------------------

/** The version the debug surface reports as `version`. */
export const SPECTRA_DEBUG_VERSION = 1;

/** The seed a run uses when `reset()` is called without one. */
export const DEFAULT_SEED = 1;

/** The key that toggles the debug overlay. */
export const OVERLAY_KEY = "Backquote";

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * Spectra needs left/right movement and two constant actions — fire and flip — and
 * this is the catalogue layout that carries two buttons. Its whole vocabulary is
 * registered, so `a` fires and `b` flips; `discharge` is Spectra's own action,
 * registered beyond the layout.
 */
export const LAYOUT = "dpad-4-two-buttons";

/** Every action Spectra registers: the layout's pad and buttons, its own discharge, and the menu and system vocabulary. */
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

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding is
 * a physical key rather than a layout-dependent character. `specs/controls.md`
 * states the same table in prose.
 *
 * Several keys deliberately drive more than one action. `Space` both fires and
 * confirms, and `ArrowUp` and `KeyW` both fire and move a menu selection up,
 * because the hand that plays the game is the hand that leaves the menus; and
 * `Escape` both pauses and goes back, because it is the key a player reaches for to
 * leave whatever is in front of them. Each screen reads only the actions in its own
 * row of `specs/controls.md`, so no key ever does two things at once.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  a: ["Space", "ArrowUp", "KeyW"],
  b: ["KeyF", "ShiftLeft", "ShiftRight"],
  discharge: ["KeyX"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The nine cues the game plays, named once here and defined against these names. */
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
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Levels and actor tags (specs/state.md) ------------------------------

/**
 * The name the level registry is keyed by, and the only level the game has. Every
 * screen — the title, the how-to, the stage intro, the live wave, the pause, the
 * stage-cleared interstitial and game over — is a value of the state's `screen`
 * field rather than a level of its own, so the world and its game state live for
 * the whole session and the wave survives a stage advance without the world being
 * rebuilt.
 */
export const LEVELS = {
  field: "field",
} as const;

export type LevelName = (typeof LEVELS)[keyof typeof LEVELS];

/**
 * The tag each of the field's actors carries, so `world.byTag` finds them under the
 * names the specification uses.
 */
export const TAGS = {
  ship: "ship",
  drone: "drone",
  playerBullet: "player-bullet",
  enemyBullet: "enemy-bullet",
  burst: "burst",
} as const;

export type TagName = (typeof TAGS)[keyof typeof TAGS];
