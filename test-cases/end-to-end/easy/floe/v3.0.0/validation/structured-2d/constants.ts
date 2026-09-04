// Floe — every figure the specification fixes, restated on the validator's side.
// CASE-PROVIDED.
//
// WHY THIS FILE EXISTS AT ALL. Under an engine the case seeds the build a
// `src/constants.ts` carrying these same figures, and a check in this project
// could import them from there. A check that does grades nothing: it compares
// the build's behaviour against the build's own copy of the number the behaviour
// came from, which agrees for every build, including one whose number is wrong.
// So everything below is read out of `specs/` and written here, under the name
// the specification gives it, and a check asserts the CASE's figure against the
// BUILD's behaviour.
//
// NOTHING HERE IS EVER READ FROM THE BUILD. Every figure below is transcribed,
// and the specification leaves this project nothing it has to ask the build for,
// so the file carries no re-export block at all. The one reference this project
// makes to the build is `harness.ts` taking its ENTRY, `../src/game`, which is
// the game a check drives; no file here reaches for `../src/constants` or any
// other module of it.
//
// NOTHING HERE IS A TOLERANCE. The figures are the specification's; the
// tolerance a check allows around one is the check's own business and is stated
// in the check, beside the figure it is a tolerance on. A helper that carried a
// threshold would hide what the check is really asserting, so this file carries
// none — not a colour distance, not a percentage, not a tick budget.
//
// Every value is in the fixed 1280x720 logical stage `specs/overview.md` fixes
// (origin top-left, `x` right, `y` down). There is ONE coordinate system in this
// game and it is the stage's, so the tile map below carries the strait's own
// offset rather than leaving a second, strait-local space to convert out of. A
// body — the critter, a bear, the bonus catch — is reported by its CENTER; a lane
// item by its LEFT EDGE.

/* -------------------------------------------------------------------------- */
/* The stage (specs/overview.md, specs/strait.md)                             */
/* -------------------------------------------------------------------------- */

/** The logical design size every build fits onto its canvas. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The HUD bar spans the full width above the strait, `y` in `[0, HUD_H]`. */
export const HUD_H = 80;

/** The strait itself, beneath the HUD bar. */
export const STRAIT_TOP = 80;
export const STRAIT_W = 1280;
/* -------------------------------------------------------------------------- */
/* The tile grid and the tile-to-stage map (specs/strait.md)                  */
/* -------------------------------------------------------------------------- */

/** A tile's side, in stage units, and the grid's extent. */
export const TILE = 32;
export const COLS = 40;
export const ROWS = 20;

/** The stage `x` of a tile column's left edge. */
export function tileLeft(col: number): number {
  return TILE * col;
}

/** The stage `y` of a tile row's top edge. */
export function tileTop(row: number): number {
  return STRAIT_TOP + TILE * row;
}

/** The stage `x` of a tile column's CENTER. */
export function tileCX(col: number): number {
  return TILE * col + TILE / 2;
}

/** The stage `y` of a tile row's CENTER. */
export function tileCY(row: number): number {
  return STRAIT_TOP + TILE * row + TILE / 2;
}

/** The column a stage `x` falls in, unclamped. */
export function colAt(x: number): number {
  return Math.floor(x / TILE);
}

/** The row a stage `y` falls in, unclamped. */
export function rowAt(y: number): number {
  return Math.floor((y - STRAIT_TOP) / TILE);
}

/* -------------------------------------------------------------------------- */
/* The five bands and the five bays (specs/strait.md)                         */
/* -------------------------------------------------------------------------- */

/** The solid cap of the far shore, behind the bays. */
export const ROW_CAP = 0;
/** The far-shore row the five bays are cut into. */
export const ROW_BAYS = 1;
/** The water band, rows `WATER_TOP` to `WATER_BOTTOM`. */
export const WATER_TOP = 2;
export const WATER_BOTTOM = 9;
/** The median shelf: solid, carrying no lane. */
export const ROW_MEDIAN = 10;
/** The ice band, rows `ICE_TOP` to `ICE_BOTTOM`. */
export const ICE_TOP = 11;
export const ICE_BOTTOM = 18;
/** The near shore: solid, where a crossing begins and a bear emerges. */
export const ROW_NEAR = 19;

/** The column a crossing begins on. */
export const START_COL = 20;

/** The five bays, left to right, as the column pairs they occupy on `ROW_BAYS`. */
export const BAYS: readonly (readonly [number, number])[] = [
  [3, 4],
  [11, 12],
  [19, 20],
  [27, 28],
  [35, 36],
];

/** How many bays the far shore carries. */
export const BAY_COUNT = 5;

/* -------------------------------------------------------------------------- */
/* The simulation (specs/overview.md)                                         */
/* -------------------------------------------------------------------------- */

/** Simulation ticks per second, and one tick in seconds. */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;

/* -------------------------------------------------------------------------- */
/* Hopping (specs/hopping.md)                                                 */
/* -------------------------------------------------------------------------- */

/** The seconds between one hop and the next. */
export const HOP_COOLDOWN = 0.12;

/* -------------------------------------------------------------------------- */
/* The two bands' lanes (specs/ice.md, specs/water.md)                        */
/* -------------------------------------------------------------------------- */

/** The three vehicle kinds the ice band carries. */
export type VehicleKind = "plow" | "dogsled" | "car";
/** The three floe kinds the water band carries. */
export type FloeKind = "pan" | "raft3" | "raft4";
/** Either band's item kind. */
export type ItemKind = VehicleKind | FloeKind;
/** A lane's direction: `1` rightward, `-1` leftward. */
export type LaneDir = 1 | -1;

/** Each kind's length, in tiles. */
export const ITEM_LEN: Readonly<Record<ItemKind, number>> = {
  plow: 3,
  dogsled: 2,
  car: 2,
  pan: 1,
  raft3: 3,
  raft4: 4,
};

/** One row of a band table: what the lane carries, which way, how fast, how far apart. */
interface LaneSpec {
  /** The strait row the lane occupies. */
  readonly row: number;
  /** The single kind every item in the lane is. */
  readonly kind: ItemKind;
  /** Which way the lane runs. */
  readonly dir: LaneDir;
  /** Tiles per second at level 1. */
  readonly speed: number;
  /** Whole tiles of clear ice or open water between consecutive items. */
  readonly gap: number;
}

/** The ice band, rows 11 to 18 (specs/ice.md). */
export const ICE_LANES: readonly LaneSpec[] = [
  { row: 11, kind: "plow", dir: -1, speed: 1.7, gap: 8 },
  { row: 12, kind: "car", dir: 1, speed: 2.1, gap: 7 },
  { row: 13, kind: "dogsled", dir: -1, speed: 2.5, gap: 7 },
  { row: 14, kind: "plow", dir: 1, speed: 1.6, gap: 8 },
  { row: 15, kind: "car", dir: -1, speed: 2.0, gap: 7 },
  { row: 16, kind: "dogsled", dir: 1, speed: 2.3, gap: 7 },
  { row: 17, kind: "plow", dir: -1, speed: 1.5, gap: 8 },
  { row: 18, kind: "car", dir: 1, speed: 1.8, gap: 7 },
];

/** The water band, rows 2 to 9 (specs/water.md). */
export const WATER_LANES: readonly LaneSpec[] = [
  { row: 2, kind: "raft3", dir: -1, speed: 3.3, gap: 3 },
  { row: 3, kind: "raft4", dir: 1, speed: 3.5, gap: 3 },
  { row: 4, kind: "raft3", dir: -1, speed: 4.2, gap: 3 },
  { row: 5, kind: "pan", dir: 1, speed: 3.6, gap: 2 },
  { row: 6, kind: "raft4", dir: -1, speed: 3.2, gap: 3 },
  { row: 7, kind: "raft3", dir: 1, speed: 3.8, gap: 3 },
  { row: 8, kind: "pan", dir: -1, speed: 3.4, gap: 2 },
  { row: 9, kind: "raft4", dir: 1, speed: 3.0, gap: 3 },
];

/** How much faster every lane runs each level, and how often a gap widens. */
export const LEVEL_SPEED_STEP = 1.06;
export const LEVEL_GAP_EVERY = 3;

/** The lane table entry for a strait row, or `null` where the row carries no lane. */
function laneSpecFor(row: number): LaneSpec | null {
  return (
    ICE_LANES.find((lane) => lane.row === row) ??
    WATER_LANES.find((lane) => lane.row === row) ??
    null
  );
}

/** A lane's speed at a level, in tiles per second. */
export function laneSpeed(row: number, level: number): number {
  const spec = laneSpecFor(row);
  if (spec === null) return 0;
  return spec.speed * Math.pow(LEVEL_SPEED_STEP, level - 1);
}

/** A lane's gap at a level, in whole tiles. */
export function laneGap(row: number, level: number): number {
  const spec = laneSpecFor(row);
  if (spec === null) return 0;
  return spec.gap + Math.floor((level - 1) / LEVEL_GAP_EVERY);
}

/* -------------------------------------------------------------------------- */
/* The hunter (specs/hunter.md)                                               */
/* -------------------------------------------------------------------------- */

/** Tiles per second a bear travels, on ice footing and swimming, at level 1. */
export const BEAR_ICE_SPEED = 3;
export const BEAR_SWIM_SPEED = 2;
/** How much faster a bear travels each level. */
export const BEAR_SPEED_STEP = 1.06;

/** A bear's ice speed at a level, in tiles per second. */
export function bearIceSpeed(level: number): number {
  return BEAR_ICE_SPEED * Math.pow(BEAR_SPEED_STEP, level - 1);
}

/** A bear's swimming speed at a level, in tiles per second. */
export function bearSwimSpeed(level: number): number {
  return BEAR_SWIM_SPEED * Math.pow(BEAR_SPEED_STEP, level - 1);
}

/** What the first slot needs: rows of advance, and seconds since it fell empty. */
export const BEAR_EMERGE_ADVANCE = 3;
export const BEAR_EMERGE_DELAY = 0.6;
/** What the second slot needs BEYOND the first's. */
export const BEAR_SECOND_ADVANCE = 3;
export const BEAR_SECOND_DELAY = 1.4;

/** Units between two centers that counts as a catch. */
export const BEAR_CATCH_DIST = 18;
/** Seconds of a lane's motion a bear treats a tile as already covered within. */
export const BEAR_AVOID_LEAD = 0.35;

/** The first level a second bear hunts on, and how many ever hunt at once. */
export const SECOND_BEAR_LEVEL = 5;
export const MAX_BEARS = 2;

/* -------------------------------------------------------------------------- */
/* The run (specs/progression.md)                                             */
/* -------------------------------------------------------------------------- */

/** The lives a run opens with, counting the critter currently crossing. */
export const START_LIVES = 3;
/** The levels a run is. */
export const TOTAL_LEVELS = 8;

/** The crossing timer: its level-1 length, its step per level, and its floor. */
export const TIMER_BASE = 30;
export const TIMER_PER_LEVEL = 2;
export const TIMER_MIN = 15;

/** The seconds a crossing at `level` is given. */
export function crossingTimer(level: number): number {
  return Math.max(TIMER_MIN, TIMER_BASE - (level - 1) * TIMER_PER_LEVEL);
}

/** The three holds, in seconds. */
export const DEATH_PAUSE = 0.9;
export const CLEAR_PAUSE = 1.6;
export const BAYFILL_PAUSE = 0.5;

/** The score a bonus life is earned at every multiple of. */
export const BONUS_LIFE_EVERY = 10000;

/* -------------------------------------------------------------------------- */
/* The bays and the bonus catch (specs/bays.md)                               */
/* -------------------------------------------------------------------------- */

/** Seconds a bonus catch lingers in its bay, and seconds between one and the next. */
export const FISH_LINGER = 5;
export const FISH_INTERVAL = 8;

/* -------------------------------------------------------------------------- */
/* Scoring (specs/scoring.md)                                                 */
/* -------------------------------------------------------------------------- */

export const SCORE_ROW = 10;
export const SCORE_BAY = 50;
export const SCORE_TIME_BONUS = 2;
export const SCORE_LEVEL = 100;
export const SCORE_VICTORY_LIFE = 250;
export const SCORE_BONUS_CATCH = 200;

/* -------------------------------------------------------------------------- */
/* The seeded sprite art (specs/assets.md)                                    */
/* -------------------------------------------------------------------------- */

/** A sprite frame's side, in source pixels, for the one-tile sheets. */
export const SPRITE_TILE = 32;

/** How many frames each folder holds. */
export const CROSSER_FRAMES = 8;
export const BEAR_FRAMES = 18;
export const PLOW_FRAMES = 1;
export const DOGSLED_FRAMES = 1;
export const CAR_FRAMES = 1;
export const PAN_FRAMES = 1;
export const RAFT_FRAMES = 2;

/** The source width of one frame of each of the wider sheets. */
export const PLOW_W = 96;
export const DOGSLED_W = 64;
export const CAR_W = 64;
export const PAN_W = 32;
export const RAFT_W = 128;

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/ui.md)                                                  */
/* -------------------------------------------------------------------------- */

export const TITLE_TEXT = "FLOE";
export const TAGLINE_TEXT = "DON'T LOOK BACK";

export const TITLE_ITEMS = ["CROSS", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const ENDING_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/** The one HUD label the specification fixes. */
export const HUD_LEVEL_LABEL = "LEVEL";

/* -------------------------------------------------------------------------- */
/* Input (specs/controls.md)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The eight actions the game registers with the engine, and no others
 * (`specs/controls.md`, "How input reaches the game"). The engine handles the
 * debug overlay's `Backquote` itself rather than through a registered action, so
 * that key is deliberately outside this list.
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

/** One intent the game answers to. */
type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is fired by, as `KeyboardEvent.code` values, so a binding
 * is a physical key rather than a layout-dependent character.
 *
 * `specs/controls.md` states this table in full: the engine owns the keyboard,
 * and the game names its actions and the keys behind them. `Escape` deliberately
 * drives two of them — it pauses a live crossing, and it goes back out of
 * whatever screen is in front of the player.
 *
 * WHAT READS THIS TABLE, AND WHAT DOES NOT. A suite whose requirement is
 * somewhere the key merely LEADS to — a screen a confirm opens, a silence a mute
 * leaves behind — presses `BINDINGS.<action>[0]`, so the route is stated once
 * here rather than transcribed at each site. The per-key `controls/*` suites do
 * the opposite and name their key as a literal, because for those the key IS the
 * requirement: `controls/key-w` decides `KeyW` and nothing else, and reading the
 * key out of this table would turn "the build answers to this key" into "the
 * build does what it says it does".
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP", "Escape"],
  mute: ["KeyM"],
};

/* -------------------------------------------------------------------------- */
/* Audio (specs/ui.md)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The ten cues, under the names `specs/ui.md` gives them.
 *
 * Under an engine a cue is played through the engine's own bus by name, so a cue
 * name IS observable and a check in this project may assert one — which is why
 * these names are the specification's and not the build's.
 */
export const CUES = {
  hop: "hop",
  splash: "splash",
  crush: "crush",
  caught: "caught",
  bay: "bay",
  levelClear: "level-clear",
  bonusLife: "bonus-life",
  victory: "victory",
  gameOver: "game-over",
  menu: "menu",
} as const;

/**
 * The touch layout the engine is built with, whose vocabulary the game
 * registers.
 *
 * TRANSCRIBED, NOT READ OFF THE BUILD. `specs/controls.md` names the layout
 * outright — "`LAYOUT` (`dpad-4`) is the touch layout the engine is built with:
 * a four-way pad whose own vocabulary is the four movement actions, to which the
 * engine appends the four menu actions" — so it is a figure the specification
 * fixes rather than a choice it leaves open, and this project states it here the
 * way it states every other figure. Reading it out of the build would make "the
 * build registers the vocabulary the specification names" into "the build
 * registers the vocabulary the build names".
 */
export const LAYOUT = "dpad-4";
