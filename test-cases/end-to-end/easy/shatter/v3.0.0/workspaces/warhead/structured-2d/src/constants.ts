// Shatter — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down; angles measured
// clockwise from +x, so straight up is -90 degrees). That space is the engine's
// logical design size: the engine scales and letterboxes it onto the canvas, so
// no value here is ever expressed in real pixels and gameplay never leaves
// logical space. Every position is an entity's CENTRE.
//
// Every rate is PER SECOND and every duration is in SECONDS, with two deliberate
// exceptions: FIRE_INTERVAL_TICKS and TRAIL_TICKS are in whole simulation ticks,
// because `specs/weapons.md` fixes them that way. The engine hands the game the
// real elapsed seconds of each frame and imposes no timestep of its own;
// `specs/simulation.md` fixes the game's own, TICK_HZ, which the build runs by
// accumulating those deltas.
//
// What is NOT here is the look. No color, no font stack and no HUD layout
// figure: `specs/overview.md` leaves the palette, the type and every other
// aspect of the appearance to the build, and BACKGROUND is the build's own
// export from `src/game.ts`.

import type { ActionBinding } from "@test-cabinet/structured-2d";

// ---- Field and star (specs/field.md) -------------------------------------

export const FIELD_W = 1280;
export const FIELD_H = 720;

/** The star, fixed at the field's centre for the whole game. */
export const STAR_X = 640;
export const STAR_Y = 360;

/** The solid core: the one physical boundary on the field. */
export const CORE_R = 30;

/** The decorative halo's reach. Nothing of the star is drawn beyond 1.5x this. */
export const HALO_R = 120;

// ---- Simulation (specs/simulation.md) ------------------------------------

/** The game's fixed timestep. The simulation advances in whole ticks of TICK_DT. */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;

/** Degrees to radians, for the angles stated in degrees below. */
export const DEG = Math.PI / 180;

// ---- Gravity (specs/gravity.md) ------------------------------------------

/** The gravitational parameter: acceleration is MU / d^2 toward the star. */
export const MU = 4_500_000;

/** The softening radius: inside it the pull is capped at MU / SOFTEN^2. */
export const SOFTEN = 90;

// ---- The ship (specs/ship.md) --------------------------------------------

export const SHIP_R = 14;
export const SHIP_TURN = 300 * DEG; // radians per second
export const SHIP_THRUST = 480; // units per second squared, along the facing
export const SHIP_DRAG_HALFLIFE = 3.0; // seconds for an un-thrusting ship to halve
export const SHIP_MAX = 680; // speed cap, applied after thrust each tick

/** The safe point a life begins at, and the facing it begins with. */
export const SAFE_X = 640;
export const SAFE_Y = 560;
export const FACE_UP = -90 * DEG;

/** The blinking grace a respawned ship carries. */
export const INVULN_TIME = 2.5;

// ---- Bullets (specs/weapons.md) ------------------------------------------

export const BULLET_R = 3;
export const MUZZLE_SPEED = 520; // added along the facing, on top of the ship's velocity
export const BULLET_LIFE = 1.5; // seconds
export const MAX_BULLETS = 4; // of the ship's bullets in flight at once
export const FIRE_INTERVAL_TICKS = 22; // whole ticks between shots
export const TRAIL_TICKS = 18; // ticks of recent travel a bullet's trail spans

// ---- Rocks (specs/rocks.md) ----------------------------------------------

export type RockSize = "large" | "medium" | "small";

/** Collision radius by size. */
export const ROCK_RADIUS: Readonly<Record<RockSize, number>> = {
  large: 46,
  medium: 26,
  small: 14,
};

/** The base drift speed range a rock enters the field at, by size. */
export const ROCK_SPEED_MIN: Readonly<Record<RockSize, number>> = {
  large: 60,
  medium: 90,
  small: 130,
};

export const ROCK_SPEED_MAX: Readonly<Record<RockSize, number>> = {
  large: 110,
  medium: 150,
  small: 210,
};

/** The size a destroyed rock breaks into; a Small breaks into nothing. */
export const ROCK_CHILD: Readonly<Record<RockSize, RockSize | null>> = {
  large: "medium",
  medium: "small",
  small: null,
};

/** The fan a gun kill throws its two fragments apart with. */
export const SPLIT_KICK = 90;

// ---- Armor (specs/rocks.md) ----------------------------------------------

/** The bullet hits a rock takes before it is destroyed, by size. */
export const ROCK_HEALTH: Readonly<Record<RockSize, number>> = {
  large: 3,
  medium: 2,
  small: 1,
};

/** How long a rock flashes when a hit chips it without destroying it. */
export const HIT_FLASH_TIME = 0.1;

// ---- The torpedo (specs/weapons.md) --------------------------------------

export const TORPEDO_R = 6;
export const TORPEDO_SPEED = 420; // constant, self-propelled
export const TORPEDO_TURN = 160 * DEG; // radians per second, onto an acquired target
export const TORPEDO_CONE = 15 * DEG; // half-angle of the forward acquisition cone
export const TORPEDO_LIFE = 3.5; // seconds before an un-hit torpedo expires
export const TORPEDO_RECHARGE = 10; // seconds for the charge to rise linearly from 0 to 1

/** The fan a torpedo kill throws its two fragments apart with, radially outward. */
export const TORPEDO_SCATTER = 240;

// ---- The saucer (specs/saucer.md) ----------------------------------------

export const SAUCER_R = 18;
export const SAUCER_SPEED = 140; // horizontal crossing speed
export const SAUCER_WEAVE_SPEED = 90; // vertical weave speed
export const SAUCER_WEAVE_INTERVAL = 1.0; // seconds between weave rerolls
export const SAUCER_FIRE_INTERVAL = 1.6; // seconds between aimed shots
export const SAUCER_AIM_ERROR = 10 * DEG; // drawn afresh, uniformly, for every shot
export const SAUCER_BULLET_SPEED = 300; // plus the saucer's own velocity
export const SAUCER_BULLET_R = 3;
export const SAUCER_BULLET_LIFE = 1.4; // seconds
export const SAUCER_LIFETIME = 12; // seconds on the field before it leaves
export const SAUCER_FIRST_DELAY = 18; // seconds into a game before the first arrives
export const SAUCER_GAP_MIN = 25; // seconds between one leaving and the next arriving
export const SAUCER_GAP_MAX = 35;

// ---- Waves (specs/progression.md) ----------------------------------------

export const WAVE_BASE_ROCKS = 3; // wave N spawns WAVE_BASE_ROCKS + N Large rocks
export const WAVE_SPEED_STEP = 0.04; // +4% base drift per wave...
export const WAVE_SPEED_CAP = 0.4; // ...capped at +40%
export const WAVE_BANNER_TIME = 1.5; // seconds the WAVE N banner shows
export const WAVE_MIN_SHIP_DIST = 300; // a wave spawns at least this far from the ship
export const WAVE_MIN_STAR_DIST = 200; // ...and this far from the star

// ---- The run and the score (specs/progression.md, specs/scoring.md) ------

export const START_LIVES = 3; // ships at the start of a game, INCLUDING the one in play
export const EXTRA_LIFE_STEP = 10_000; // one extra ship each time the score crosses a multiple

export const SCORE_LARGE = 20;
export const SCORE_MEDIUM = 50;
export const SCORE_SMALL = 100;
export const SCORE_SAUCER = 200;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "SHATTER";
export const TAGLINE_TEXT = "GRAVITY WELL SHOOTER";
export const TITLE_ITEMS = ["PLAY", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const GAMEOVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;

// ---- Levels (specs/state.md) ---------------------------------------------

/**
 * The names the level registry is keyed by, and the only level the game has.
 * Every screen Shatter shows is a field of the game state rather than a level of
 * its own, so one level hosts all five.
 */
export const LEVELS = {
  field: "field",
} as const;

export type LevelName = (typeof LEVELS)[keyof typeof LEVELS];

// ---- Input actions (specs/controls.md) -----------------------------------

/** Four-way movement plus two action buttons: Shatter needs both. */
export const LAYOUT = "dpad-4-two-buttons";

/**
 * Every action Shatter registers, in the `dpad-4-two-buttons` layout's own
 * order: the layout's four movement actions, its two buttons, then the menu
 * vocabulary every layout carries. This list must equal
 * `TOUCH_LAYOUTS[LAYOUT].actions`.
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "a",
  "b",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The binding each action is registered under, ready to hand to the engine's
 * input registration. Keys are `KeyboardEvent.code` values so a binding is a
 * physical key rather than a layout-dependent character; every action is
 * digital, so no binding names a kind.
 *
 * `Escape` deliberately drives TWO actions, `pause` and `back` — one key meaning
 * "get me out of here", which is a pause in play and a step back on a menu. The
 * game reads whichever of the two the current screen calls for.
 *
 * `b` is the torpedo, on its own key.
 */
export const BINDINGS: Readonly<Record<ActionName, ActionBinding>> = {
  up: { keys: ["ArrowUp", "KeyW"] },
  down: { keys: ["ArrowDown", "KeyS"] },
  left: { keys: ["ArrowLeft", "KeyA"] },
  right: { keys: ["ArrowRight", "KeyD"] },
  a: { keys: ["Space"] },
  b: { keys: ["KeyF"] },
  confirm: { keys: ["Enter", "Space"] },
  back: { keys: ["Escape"] },
  pause: { keys: ["KeyP", "Escape"] },
  mute: { keys: ["KeyM"] },
};

// ---- Audio cues (specs/audio.md) -----------------------------------------

/** The six cue names, one per event. Define and play exactly these. */
export const CUES = {
  fire: "fire",
  shatter: "shatter",
  thrust: "thrust",
  saucer: "saucer",
  death: "death",
  extraLife: "extra-life",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const SHATTER_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;
