// Volute — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every length is in logical units of the fixed 960x540 field defined by
// `specs/overview.md` (origin top-left, x right, y down). That field is the
// engine's logical design size: the engine scales and letterboxes it onto the
// canvas, so no value here is ever expressed in real pixels.
//
// Every angle is in degrees, measured from +x and increasing toward +y. Every
// rate is per second and every duration is in seconds. The simulation advances
// in fixed ticks of TICK_DT: the frame's delta time accumulates, whole ticks are
// consumed, and the remainder waits for the next frame.
//
// This file fixes no palette, font, glyph shape, sprite artwork, or layout.
// `specs/ui.md` and `specs/assets.md` state what must be legible, and how the
// hall looks is the build's to design.

// ---- Field (specs/overview.md) -------------------------------------------

/** The logical design size. */
export const FIELD_W = 960;
export const FIELD_H = 540;

// ---- Ticks (specs/overview.md) -------------------------------------------

/** The fixed simulation rate, in ticks per second. */
export const TICK_HZ = 60;

/** The length of one tick, in seconds. */
export const TICK_DT = 1 / TICK_HZ;

// ---- Geometry ------------------------------------------------------------

export interface Point {
  readonly x: number;
  readonly y: number;
}

// ---- The channel ---------------------------------------------------------

/**
 * The channel's vertices, in order, the inlet first and the intake last. A core
 * sits at an arc distance `s` from the inlet, walked along this polyline.
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

/** The channel's total arc length. The inlet is `s = 0`. */
export const PATH_LENGTH = 5000;

/** The arc position of the intake. */
export const INTAKE_S = PATH_LENGTH;

/** The head's arc position at or beyond which the hall is in danger. */
export const DANGER_S = 4000;

// ---- Cores ---------------------------------------------------------------

export const CORE_RADIUS = 14;

/** The arc distance between consecutive cores within one segment. */
export const SPACING = 28;

/** The number of cores the channel opens a level with. */
export const SEEDED_CORES = 12;

/** The seeded head's arc position; the seeded tail sits at `s = 0`. */
export const SEEDED_HEAD_S = 308;

/** The speed a segment behind the lead segment closes at. */
export const CATCHUP_SPEED = 180;

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

// ---- Pressure ------------------------------------------------------------

export const PRESSURE_MIN = 0;
export const PRESSURE_MAX = 100;

/** Cores on the channel carried at no cost. */
export const PRESSURE_FREE = 24;

/** Pressure gained per second, per core beyond PRESSURE_FREE. */
export const PRESSURE_RISE_PER_CORE = 0.05;

/** Pressure lost per second while the channel holds PRESSURE_FREE or fewer. */
export const PRESSURE_BLEED = 2.0;

/** Pressure lost per extracted core. */
export const PRESSURE_DROP_PER_CORE = 0.8;

// ---- The injector --------------------------------------------------------

export const INJECTOR_X = 420;
export const INJECTOR_Y = 330;
export const INJECTOR_RADIUS = 22;

/** The aim the injector opens at, in degrees. */
export const AIM_START = 270;

/** The rate the aim turns at while a rotate action is held. */
export const AIM_TURN_RATE = 180;

/** Seconds between firings. */
export const FIRE_COOLDOWN = 0.18;

export const PROJECTILE_RADIUS = 14;
export const PROJECTILE_SPEED = 620;

/** A projectile strikes a core within this distance of the core's center. */
export const STRIKE_DISTANCE = CORE_RADIUS + PROJECTILE_RADIUS;

// ---- Extraction and chains -----------------------------------------------

/** The shortest same-charge run that extracts. */
export const MIN_RUN = 3;

/** Score for an extraction of `n` cores at chain step `k` is `10 * n * k`. */
export const SCORE_PER_CORE = 10;

/** The arc distance the trailing part recoils by after a removal. */
export const RECOIL = 42;

/** Seconds a recoiled segment holds before it advances again. */
export const RECOIL_HOLD = 0.4;

/** Seconds without an extraction after which the chain step returns to 1. */
export const CHAIN_RESET = 2.0;

// ---- Machinery -----------------------------------------------------------

/**
 * The four machinery kinds, in the order marks cycle in, starting at the first
 * entry.
 */
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

export interface Level {
  /** The charges a level draws from, in this order. */
  readonly charges: readonly ChargeId[];
  /** Cores the inlet emits over the level, the seeded cores included. */
  readonly quota: number;
  /** The lead segment's speed before pressure and machinery. */
  readonly feedSpeed: number;
}

/** The five levels, in order. Row `i` is level `i + 1`. */
export const LEVELS: readonly Level[] = [
  { charges: ["halide", "sulfur", "cobalt"], quota: 45, feedSpeed: 22 },
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

/** Cells a run opens with. */
export const CELLS = 3;

/** Score for clearing a level. */
export const CLEAR_SCORE = 500;

/** Seconds the interlude holds before a level begins or begins again. */
export const INTERLUDE = 2.0;

// ---- Screens (specs/ui.md) -----------------------------------------------

/** Every screen the game holds. */
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

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * The injector turns and fires from one place, so a four-way pad and the two
 * buttons the shot and the swap sit on carry the whole game.
 */
export const LAYOUT = "dpad-4-two-buttons";

/**
 * Every action Volute registers, in the `dpad-4-two-buttons` layout's own
 * order: the layout's four movement actions and two buttons, followed by the
 * menu vocabulary every layout carries. This list equals
 * `TOUCH_LAYOUTS[LAYOUT].actions`.
 *
 * On the `playing` screen `left` and `right` turn the aim, `a` fires, and `b`
 * exchanges the loaded and queued cores. Each other screen reads the menu
 * vocabulary in its own row of `specs/controls.md`.
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
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character.
 *
 * `Space` deliberately drives TWO actions, `a` and `confirm`, and `Escape`
 * drives `back` and `pause`. Each screen reads the actions its own row of
 * `specs/controls.md` names and leaves the rest alone.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  a: ["Space"],
  b: ["KeyX"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/assets.md) ----------------------------------------

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

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const VOLUTE_DEBUG_VERSION = 1;
