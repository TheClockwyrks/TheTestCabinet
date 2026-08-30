// Volute — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every position and distance is in the fixed 960x540 logical coordinate space
// defined by `specs/overview.md` (origin top-left, x right, y down). That space
// is the engine's logical design size: the engine scales and letterboxes it onto
// the canvas, so no value here is ever expressed in real pixels and gameplay
// never leaves logical space.
//
// Every angle is in degrees, measured from +x and increasing toward +y. Every
// rate is per second and every duration is in seconds, integrated against the
// elapsed seconds the engine hands each tick.
//
// This file fixes no palette, font, glyph shape, sprite artwork, or layout.
// `specs/ui.md` and `specs/assets.md` state what must be legible, and how the
// hall looks is the build's to design.

import type { ActionBinding } from "@test-cabinet/structured-2d";

// ---- Field ---------------------------------------------------------------

export const FIELD_W = 960;
export const FIELD_H = 540;

export interface Point {
  readonly x: number;
  readonly y: number;
}

// ---- The channel ---------------------------------------------------------

/**
 * The channel's vertices, in order, the inlet first and the intake last. A
 * core's position is its arc distance from the inlet, walked along this
 * polyline.
 */
export const CHANNEL: readonly Point[] = [
  { x: 40, y: 40 },
  { x: 920, y: 40 },
  { x: 920, y: 500 },
  { x: 120, y: 500 },
  { x: 120, y: 120 },
  { x: 840, y: 120 },
  { x: 840, y: 420 },
  { x: 220, y: 420 },
  { x: 220, y: 220 },
  { x: 620, y: 220 },
  { x: 620, y: 320 },
  { x: 480, y: 320 },
];

/** The arc length of the whole channel. The inlet is `s = 0`. */
export const PATH_LENGTH = 5000;

/** The arc position of the intake. */
export const INTAKE_S = PATH_LENGTH;

// ---- Charges -------------------------------------------------------------

/** The five charges. */
export const CHARGE_IDS = [
  "halide",
  "sulfur",
  "cobalt",
  "garnet",
  "olivine",
] as const;

export type ChargeId = (typeof CHARGE_IDS)[number];

// ---- Cores and the train -------------------------------------------------

export const CORE_RADIUS = 14;

/** The arc distance between two consecutive cores of one segment. */
export const SPACING = 28;

/** The speed a segment behind the lead segment closes the gap at. */
export const CATCHUP_SPEED = 180;

/** Cores on the channel when a level starts, and the head's arc position. */
export const SEEDED_CORES = 12;
export const SEEDED_HEAD_S = 308;

// ---- Pressure ------------------------------------------------------------

export const PRESSURE_MIN = 0;
export const PRESSURE_MAX = 100;

/** Cores on the channel that raise no pressure. */
export const PRESSURE_FREE = 24;

/** Pressure gained per second, per core beyond `PRESSURE_FREE`. */
export const PRESSURE_RISE_PER_CORE = 0.05;

/** Pressure lost per second while the channel is at or under the free count. */
export const PRESSURE_BLEED = 2.0;

/** Pressure lost per extracted core. */
export const PRESSURE_DROP_PER_CORE = 0.8;

// ---- The injector --------------------------------------------------------

export const INJECTOR_X = 420;
export const INJECTOR_Y = 330;
export const INJECTOR_RADIUS = 22;

/** The aim the injector opens at, in degrees. */
export const AIM_START = 270;

/** Degrees per second the aim turns while a rotate action is held. */
export const AIM_TURN_RATE = 180;

export const FIRE_COOLDOWN = 0.18;
export const PROJECTILE_RADIUS = 14;
export const PROJECTILE_SPEED = 620;

// ---- Insertion and extraction --------------------------------------------

/** The greatest center distance at which a projectile strikes a core. */
export const STRIKE_DISTANCE = CORE_RADIUS + PROJECTILE_RADIUS;

/** The shortest same-charge run that extracts. */
export const MIN_RUN = 3;

/** An extraction of `n` cores at chain step `k` scores this times `n` times `k`. */
export const SCORE_PER_CORE = 10;

/** Arc distance the trailing part falls back by after a removal. */
export const RECOIL = 42;

/** Seconds a recoiled segment holds before it advances again. */
export const RECOIL_HOLD = 0.4;

/** Seconds without an extraction after which the chain step returns to 1. */
export const CHAIN_RESET = 2.0;

// ---- Machinery -----------------------------------------------------------

/** The four kinds, in the order the marks cycle through them. */
export const MACHINERY_KINDS = [
  "choke",
  "backflow",
  "bore",
  "sightline",
] as const;

export type MachineryKind = (typeof MACHINERY_KINDS)[number];

/** Every MARK_INTERVAL-th core emitted in a level carries a mark. */
export const MARK_INTERVAL = 12;

/** Seconds each timed machinery stays active. `bore` resolves at once. */
export const MACHINERY_DURATIONS: Readonly<Record<MachineryKind, number>> = {
  choke: 8,
  backflow: 5,
  bore: 0,
  sightline: 12,
};

/** The feed speed multiplier while `choke` is active. */
export const CHOKE_FEED_MULTIPLIER = 0.4;

/** The speed the train moves toward the inlet at while `backflow` is active. */
export const BACKFLOW_SPEED = 60;

/** The radius `bore` removes cores within, measured from the extraction point. */
export const BORE_RADIUS = 90;

// ---- Levels --------------------------------------------------------------

export interface LevelSpec {
  /** The charges in play. */
  readonly charges: readonly ChargeId[];
  /** Cores the inlet emits over the level, the seeded cores included. */
  readonly quota: number;
  /** The level's feed speed, before pressure and choke are applied. */
  readonly feedSpeed: number;
}

/** The five levels, in order. Level 1 is the first entry. */
export const LEVELS: readonly LevelSpec[] = [
  {
    charges: ["halide", "sulfur", "cobalt"],
    quota: 45,
    feedSpeed: 22,
  },
  {
    charges: ["halide", "sulfur", "cobalt", "garnet"],
    quota: 55,
    feedSpeed: 26,
  },
  {
    charges: ["halide", "sulfur", "cobalt", "garnet"],
    quota: 65,
    feedSpeed: 30,
  },
  {
    charges: ["halide", "sulfur", "cobalt", "garnet", "olivine"],
    quota: 75,
    feedSpeed: 34,
  },
  {
    charges: ["halide", "sulfur", "cobalt", "garnet", "olivine"],
    quota: 90,
    feedSpeed: 38,
  },
];

export const LEVEL_COUNT = LEVELS.length;

// ---- The run -------------------------------------------------------------

/** Cells the run starts with. */
export const CELLS = 3;

/** Score for clearing a level. */
export const CLEAR_SCORE = 500;

/** Seconds between a level ending and the next one starting. */
export const INTERLUDE = 2;

/** The head's arc position at or beyond which the game is in danger. */
export const DANGER_S = 4000;

// ---- Screens -------------------------------------------------------------

/** Every screen the game has. */
export const SCREENS = [
  "title",
  "playing",
  "paused",
  "cleared",
  "setback",
  "gameover",
  "victory",
] as const;

export type ScreenName = (typeof SCREENS)[number];

/** The title the title screen carries. */
export const TITLE_TEXT = "VOLUTE";

// ---- Levels the engine opens, and actor tags -----------------------------

/**
 * The names the engine's level registry is keyed by, and the only two the game
 * has: `title`, the level the engine opens first, and `hall`, the level a run
 * plays in. Which screens each hosts is the game's to arrange.
 */
export const WORLDS = {
  title: "title",
  hall: "hall",
} as const;

export type WorldName = (typeof WORLDS)[keyof typeof WORLDS];

/**
 * The tag each of the hall's bodies carries, so `world.byTag` finds them under
 * the names the specification uses. Every core on the channel carries `core`,
 * every core in flight carries `projectile`, and the injector and the intake
 * carry their own.
 */
export const TAGS = {
  core: "core",
  projectile: "projectile",
  injector: "injector",
  intake: "intake",
} as const;

export type TagName = (typeof TAGS)[keyof typeof TAGS];

// ---- Input actions -------------------------------------------------------

/** Every action Volute registers. */
export const ACTIONS = [
  "aim-left",
  "aim-right",
  "fire",
  "swap",
  "confirm",
  "pause",
  "mute",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The binding each action is registered under, ready to hand to
 * `api.input.register`. Keys are `KeyboardEvent.code` values so a binding is a
 * physical key rather than a layout-dependent character; every action is
 * digital, so no binding names a kind.
 *
 * `Space` deliberately drives TWO actions, `fire` and `confirm` — one key
 * meaning "go", which fires the injector during play and dismisses a screen
 * everywhere else. The game reads whichever of the two the current screen calls
 * for.
 */
export const BINDINGS: Readonly<Record<ActionName, ActionBinding>> = {
  "aim-left": { keys: ["ArrowLeft"] },
  "aim-right": { keys: ["ArrowRight"] },
  fire: { keys: ["Space"] },
  swap: { keys: ["KeyX"] },
  confirm: { keys: ["Enter", "Space"] },
  pause: { keys: ["Escape"] },
  mute: { keys: ["KeyM"] },
};

// ---- Audio cues ----------------------------------------------------------

/** The fifteen cue names, one per event. Define and play exactly these. */
export const CUES = {
  fire: "fire",
  seat: "seat",
  swap: "swap",
  denied: "denied",
  machinery: "machinery",
  extract1: "extract-1",
  extract2: "extract-2",
  extract3: "extract-3",
  extract4: "extract-4",
  extract5: "extract-5",
  intake: "intake",
  levelClear: "level-clear",
  cellLost: "cell-lost",
  hallLoop: "hall-loop",
  dangerLoop: "danger-loop",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

/**
 * The five extraction cues, in rising order. An extraction plays the cue at its
 * chain step, and every step beyond the fifth plays the last.
 */
export const EXTRACT_CUES: readonly CueName[] = [
  CUES.extract1,
  CUES.extract2,
  CUES.extract3,
  CUES.extract4,
  CUES.extract5,
];

/** The cues that loop until stopped rather than playing once. */
export const LOOPING_CUES: readonly CueName[] = [
  CUES.hallLoop,
  CUES.dangerLoop,
];

// ---- Debug surface -------------------------------------------------------

/** The version the debug surface reports as `version`. */
export const VOLUTE_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;
