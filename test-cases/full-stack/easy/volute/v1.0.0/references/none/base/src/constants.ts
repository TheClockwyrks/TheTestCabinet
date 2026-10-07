// Volute — every figure the specification fixes.
//
// This build stands on no engine, so nothing supplies these: `specs/` states each
// one and this module is where the whole game reads it from. Nothing else in
// `src/` writes a magic number that the specification named.
//
// Units, throughout: positions and distances are logical field units, rates are
// per second, durations are seconds, and angles are degrees measured from `+x`
// and increasing toward `+y` (so an angle turns clockwise on screen).

// --- The field (specs/overview.md) -------------------------------------------

/** The logical field's width; the whole of it is on screen at every window size. */
export const FIELD_W = 960;
/** The logical field's height. */
export const FIELD_H = 540;

// --- The tick (specs/instrumentation.md) --------------------------------------

/** Simulation ticks per second. */
export const TICK_HZ = 60;
/** One tick, in seconds. Every rate above is integrated against exactly this. */
export const TICK_DT = 1 / TICK_HZ;

// --- The charges (specs/overview.md) ------------------------------------------

/** The five charges a core may carry. */
export const CHARGE_IDS = [
  "halide",
  "sulfur",
  "cobalt",
  "garnet",
  "olivine",
] as const;

/** One of the five charges. */
export type ChargeId = (typeof CHARGE_IDS)[number];

// --- The channel (specs/channel.md) -------------------------------------------

/** The channel's twelve vertices, from the inlet at index 0 to the intake at 11. */
export const CHANNEL: ReadonlyArray<readonly [number, number]> = [
  [40, 40],
  [920, 40],
  [920, 500],
  [120, 500],
  [120, 120],
  [840, 120],
  [840, 420],
  [220, 420],
  [220, 220],
  [620, 220],
  [620, 320],
  [480, 320],
];

/** The channel's total arc length; the intake stands here. */
export const PATH_LENGTH = 5000;
/** The arc distance between two cores of one segment. */
export const SPACING = 28;
/** A core's drawn radius. */
export const CORE_RADIUS = 14;
/** How fast a segment that is not the lead segment closes on the one ahead. */
export const CATCHUP = 180;
/** The cores a level opens with, standing on the channel head-first. */
export const SEED_CORES = 12;
/** The arc position of the head of the opening train. */
export const SEED_HEAD_S = 308;

// --- Pressure (specs/channel.md) ----------------------------------------------

/** The lowest pressure. */
export const PRESSURE_MIN = 0;
/** The highest pressure. */
export const PRESSURE_MAX = 100;
/** Cores the channel carries before pressure begins to rise. */
export const PRESSURE_FREE = 24;
/** Pressure gained per second for each core above {@link PRESSURE_FREE}. */
export const PRESSURE_RISE_PER_CORE = 0.05;
/** Pressure lost per second while the channel is not over {@link PRESSURE_FREE}. */
export const PRESSURE_BLEED = 2.0;
/** Pressure lost for each core a removal takes off the channel. */
export const PRESSURE_DROP_PER_CORE = 0.8;

// --- The injector (specs/injector.md) -----------------------------------------

/** The injector's center, fixed for the whole run. */
export const INJECTOR_X = 420;
/** The injector's center, fixed for the whole run. */
export const INJECTOR_Y = 330;
/** The injector's drawn radius. */
export const INJECTOR_RADIUS = 22;
/** The aim a level opens on, straight up the field. */
export const AIM_START = 270;
/** How fast a held turn action swings the aim. */
export const AIM_TURN_RATE = 180;
/** The seconds the injector holds after a shot before it may fire again. */
export const FIRE_COOLDOWN = 0.18;
/** How fast a fired core travels along its heading. */
export const PROJECTILE_SPEED = 620;
/** A projectile's drawn radius. */
export const PROJECTILE_RADIUS = 14;
/** How close a projectile's center comes to a core's before it seats. */
export const STRIKE_DISTANCE = 28;

// --- Extraction (specs/extraction.md) -----------------------------------------

/** The shortest run of one charge that is drawn out of the channel. */
export const MIN_RUN = 3;
/** The points an extraction of `n` cores at chain step `k` pays: `10 * n * k`. */
export const SCORE_PER_CORE = 10;
/** How far a removal drives the cores behind it back. */
export const RECOIL = 42;
/** How long a recoiled group stands still before it advances again. */
export const RECOIL_HOLD = 0.4;
/** How long the chain step survives without an extraction. */
export const CHAIN_RESET = 2.0;

// --- Machinery (specs/machinery.md) -------------------------------------------

/** The four machinery kinds. */
export const MACHINERY_KINDS = [
  "choke",
  "backflow",
  "bore",
  "sightline",
] as const;

/** One of the four machinery kinds. */
export type MachineryKind = (typeof MACHINERY_KINDS)[number];

/** Cores between one marked core and the next, counted from a level's start. */
export const MARK_INTERVAL = 12;
/** The order the marks of a level name their kinds in, cycling. */
export const MARK_CYCLE: readonly MachineryKind[] = [
  "choke",
  "backflow",
  "bore",
  "sightline",
];

/** What choke multiplies the feed speed by while it is active. */
export const CHOKE_FACTOR = 0.4;
/** How long choke lasts. */
export const CHOKE_DURATION = 8;
/** How fast backflow drives every core toward the inlet. */
export const BACKFLOW_SPEED = 60;
/** How long backflow lasts. */
export const BACKFLOW_DURATION = 5;
/** How far from the extraction point a bore reaches, straight across the field. */
export const BORE_RADIUS = 90;
/** How long sightline lasts. */
export const SIGHTLINE_DURATION = 12;

/** The seconds each timed machinery runs for. `bore` resolves at once. */
export const MACHINERY_DURATION: Readonly<Record<MachineryKind, number>> = {
  choke: CHOKE_DURATION,
  backflow: BACKFLOW_DURATION,
  bore: 0,
  sightline: SIGHTLINE_DURATION,
};

// --- Progression (specs/progression.md) ---------------------------------------

/** One level's figures. */
export interface LevelSpec {
  /** The charges every draw of this level falls back to. */
  readonly charges: readonly ChargeId[];
  /** The total cores the level delivers, the twelve it opens with included. */
  readonly quota: number;
  /** The lead segment's base rate, before pressure and machinery scale it. */
  readonly feed: number;
}

/** The five levels, indexed from `0` for level `1`. */
export const LEVELS: readonly LevelSpec[] = [
  { charges: ["halide", "sulfur", "cobalt"], quota: 45, feed: 22 },
  { charges: ["halide", "sulfur", "cobalt", "garnet"], quota: 55, feed: 26 },
  { charges: ["halide", "sulfur", "cobalt", "garnet"], quota: 65, feed: 30 },
  {
    charges: ["halide", "sulfur", "cobalt", "garnet", "olivine"],
    quota: 75,
    feed: 34,
  },
  {
    charges: ["halide", "sulfur", "cobalt", "garnet", "olivine"],
    quota: 90,
    feed: 38,
  },
];

/** How many levels a run plays. */
export const LEVEL_COUNT = LEVELS.length;
/** The cells a run starts with. */
export const CELLS = 3;
/** The points a cleared level pays. */
export const CLEAR_BONUS = 500;
/** How long the `cleared` and `setback` interludes hold. */
export const INTERLUDE = 2;
/** The head's arc position at and above which the run is in danger. */
export const DANGER_S = 4000;

// --- The screens (specs/ui.md) ------------------------------------------------

/** The seven screens the game holds. */
export const SCREENS = [
  "title",
  "playing",
  "paused",
  "cleared",
  "setback",
  "gameover",
  "victory",
] as const;

/** One of the seven screens. */
export type ScreenName = (typeof SCREENS)[number];

// --- The controls (specs/controls.md) -----------------------------------------

/** The actions the game reads, and the `KeyboardEvent.code` values behind each. */
export const BINDINGS: Readonly<Record<string, readonly string[]>> = {
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  fire: ["Space"],
  swap: ["KeyX"],
  confirm: ["Enter", "Space"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
};

/** The `KeyboardEvent.code` that shows and hides the debug overlay. */
export const OVERLAY_KEY = "Backquote";

// --- Audio (specs/ui.md, specs/assets.md) -------------------------------------

/** The thirteen one-shot cues and the two beds, under exactly these names. */
export const CUES = [
  "fire",
  "seat",
  "swap",
  "denied",
  "machinery",
  "extract-1",
  "extract-2",
  "extract-3",
  "extract-4",
  "extract-5",
  "intake",
  "level-clear",
  "cell-lost",
  "hall-loop",
  "danger-loop",
] as const;

/** One of the fifteen cue names. */
export type CueName = (typeof CUES)[number];

/** The cue an extraction at chain step `k` sounds; step 5 and beyond share one. */
export const EXTRACT_CUES: readonly CueName[] = [
  "extract-1",
  "extract-2",
  "extract-3",
  "extract-4",
  "extract-5",
];

/** The bed that loops under the hall while the run is not in danger. */
export const HALL_BED: CueName = "hall-loop";
/** The bed that loops under the hall while the run is in danger. */
export const DANGER_BED: CueName = "danger-loop";

// --- The debug surface (specs/instrumentation.md) ------------------------------

/** The version `window.__volute.version` reports. */
export const VOLUTE_DEBUG_VERSION = 1;
/** The `window` property the debug and automation surface is installed on. */
export const VOLUTE_HANDLE = "__volute";

// --- Screen copy (specs/ui.md) ------------------------------------------------

/** The title the front door carries. */
export const TITLE_TEXT = "VOLUTE";
