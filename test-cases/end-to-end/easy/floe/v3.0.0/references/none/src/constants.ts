// Floe — every figure the specification fixes, named once.
//
// This build stands on no engine, so nothing is supplied to it: `specs/` states
// each figure under a name and this module is where those names live. Nothing
// here is a choice — the look, the typography, the HUD layout and the sprite
// animation rates are the build's and live in `src/theme.ts`.
//
// Every position is in the fixed 1280x720 logical stage of `specs/overview.md`:
// the origin is the top-left, `x` grows rightward and `y` downward. There is ONE
// coordinate system in this game and it is the stage's, so the tile map below
// carries the strait's own offset rather than leaving a second, strait-local
// space for a reader to convert out of.

// ---- The stage (specs/overview.md, specs/strait.md) ----------------------

/** The logical design width the game draws in. */
export const STAGE_W = 1280;
/** The logical design height the game draws in. */
export const STAGE_H = 720;

/** The HUD bar: `y` in `[0, HUD_H)`. */
export const HUD_H = 80;
/** The strait's top edge; play occupies `[STRAIT_TOP, STAGE_H)`. */
export const STRAIT_TOP = 80;
/** The strait's width, which is the stage's. */
export const STRAIT_W = 1280;
/** The strait's height: twenty rows of `TILE`. */
export const STRAIT_H = 640;

/** A tile's side, in stage units. */
export const TILE = 32;
/** Columns across the strait: `0` leftmost, `COLS - 1` rightmost. */
export const COLS = 40;
/** Rows down the strait: `0` topmost, `ROWS - 1` the near shore. */
export const ROWS = 20;

// ---- The tile-to-stage map (specs/strait.md) -----------------------------
//
// The six conversions the whole game is written in. Nothing anywhere else
// multiplies a column by `TILE` or adds `STRAIT_TOP` by hand.

/** The stage `x` of a tile column's left edge. */
export function tileLeft(col: number): number {
  return TILE * col;
}

/** The stage `y` of a tile row's top edge. */
export function tileTop(row: number): number {
  return STRAIT_TOP + TILE * row;
}

/** The stage `x` of a tile column's center. */
export function tileCX(col: number): number {
  return TILE * col + TILE / 2;
}

/** The stage `y` of a tile row's center. */
export function tileCY(row: number): number {
  return STRAIT_TOP + TILE * row + TILE / 2;
}

/** The column a stage `x` falls in, unclamped: a point off the strait is off it. */
export function colAt(x: number): number {
  return Math.floor(x / TILE);
}

/** The row a stage `y` falls in, unclamped. */
export function rowAt(y: number): number {
  return Math.floor((y - STRAIT_TOP) / TILE);
}

/** Whether a tile is part of the strait at all. */
export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

// ---- The five bands (specs/strait.md) ------------------------------------

/** The solid cap of the far shore, behind the bays. */
export const ROW_CAP = 0;
/** The far-shore row the five bays are cut into. */
export const ROW_BAYS = 1;
/** The topmost water row. */
export const WATER_TOP = 2;
/** The bottommost water row. */
export const WATER_BOTTOM = 9;
/** The median shelf: solid, carrying no lane. */
export const ROW_MEDIAN = 10;
/** The topmost ice row. */
export const ICE_TOP = 11;
/** The bottommost ice row. */
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

/** How many bays a level opens with. */
export const BAY_COUNT = 5;

// ---- The simulation (specs/overview.md) ----------------------------------

/** Simulation ticks per second. */
export const TICK_HZ = 120;
/** One tick, in seconds. Every rate in the game is integrated against it. */
export const TICK_DT = 1 / TICK_HZ;

// ---- The critter (specs/hopping.md) --------------------------------------

/** The seconds between one hop and the next. */
export const HOP_COOLDOWN = 0.12;

// ---- The lanes (specs/ice.md, specs/water.md) ----------------------------

/** Every lane item's kind. */
export type ItemKind = VehicleKind | FloeKind;
/** The three vehicle kinds the ice band carries. */
export type VehicleKind = "plow" | "dogsled" | "car";
/** The three floe kinds the water band carries. */
export type FloeKind = "pan" | "raft3" | "raft4";
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
export interface LaneSpec {
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

/** How much faster every lane runs each level. */
export const LEVEL_SPEED_STEP = 1.06;
/** How many levels a lane's gap widens by one tile over. */
export const LEVEL_GAP_EVERY = 3;

/** The lane table entry for a strait row, or `null` where the row carries no lane. */
export function laneSpecFor(row: number): LaneSpec | null {
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

// ---- The bear (specs/hunter.md) ------------------------------------------

/** Tiles per second a bear travels on ice footing at level 1. */
export const BEAR_ICE_SPEED = 3;
/** Tiles per second a bear travels swimming at level 1. */
export const BEAR_SWIM_SPEED = 2;
/** How much faster a bear travels each level. */
export const BEAR_SPEED_STEP = 1.06;

/** Rows the critter must have advanced before the first slot fills. */
export const BEAR_EMERGE_ADVANCE = 3;
/** Seconds the first slot must have stood empty before it fills. */
export const BEAR_EMERGE_DELAY = 0.6;
/** Rows of advance the second slot needs beyond the first's. */
export const BEAR_SECOND_ADVANCE = 3;
/** Seconds the second slot needs beyond the first's. */
export const BEAR_SECOND_DELAY = 1.4;

/** Units between two centers that counts as a catch. */
export const BEAR_CATCH_DIST = 18;
/** Seconds of a lane's motion a bear treats a tile as already covered within. */
export const BEAR_AVOID_LEAD = 0.35;

/** The first level a second bear hunts on. */
export const SECOND_BEAR_LEVEL = 5;
/** How many bears ever hunt at once. */
export const MAX_BEARS = 2;

/** A bear's ice speed at a level, in tiles per second. */
export function bearIceSpeed(level: number): number {
  return BEAR_ICE_SPEED * Math.pow(BEAR_SPEED_STEP, level - 1);
}

/** A bear's swimming speed at a level, in tiles per second. */
export function bearSwimSpeed(level: number): number {
  return BEAR_SWIM_SPEED * Math.pow(BEAR_SPEED_STEP, level - 1);
}

// ---- The run (specs/progression.md) --------------------------------------

/** The lives a run opens with, counting the critter currently crossing. */
export const START_LIVES = 3;
/** The levels a run is. */
export const TOTAL_LEVELS = 8;

/** The crossing timer at level 1, in seconds. */
export const TIMER_BASE = 30;
/** How much shorter each level's crossing timer is. */
export const TIMER_PER_LEVEL = 2;
/** The floor the crossing timer never falls below. */
export const TIMER_MIN = 15;

/** The seconds a crossing at `level` is given. */
export function crossingTimer(level: number): number {
  return Math.max(TIMER_MIN, TIMER_BASE - (level - 1) * TIMER_PER_LEVEL);
}

/** The hold after a life is lost. */
export const DEATH_PAUSE = 0.9;
/** The hold after a level's last bay is filled. */
export const CLEAR_PAUSE = 1.6;
/** The hold after a bay is filled and before the next crossing begins. */
export const BAYFILL_PAUSE = 0.5;

/** The score a bonus life is earned at every multiple of. */
export const BONUS_LIFE_EVERY = 10000;

// ---- The bonus catch (specs/bays.md) -------------------------------------

/** Seconds a bonus catch lingers in its bay. */
export const FISH_LINGER = 5;
/** Seconds between one bonus catch leaving and the next appearing. */
export const FISH_INTERVAL = 8;

// ---- Scoring (specs/scoring.md) ------------------------------------------

/** Per row newly reached this crossing. */
export const SCORE_ROW = 10;
/** For filling a bay. */
export const SCORE_BAY = 50;
/** Per whole second left on the timer when a crossing completes. */
export const SCORE_TIME_BONUS = 2;
/** Times the level, on clearing it. */
export const SCORE_LEVEL = 100;
/** Per remaining life at victory. */
export const SCORE_VICTORY_LIFE = 250;
/** For completing a crossing into the bay holding the bonus catch. */
export const SCORE_BONUS_CATCH = 200;

// ---- The seeded sprite art (specs/assets.md) -----------------------------

/** A sprite frame's side, in source pixels, for the one-tile sheets. */
export const SPRITE_TILE = 32;

/** Frames in `assets/crosser/`: a crouch-and-leap pair per facing. */
export const CROSSER_FRAMES = 8;
/** Frames in `assets/bear/`: four run pairs, four swim pairs, and a lunge pair. */
export const BEAR_FRAMES = 18;
/** Frames in `assets/plow/`. */
export const PLOW_FRAMES = 1;
/** Frames in `assets/dogsled/`. */
export const DOGSLED_FRAMES = 1;
/** Frames in `assets/car/`. */
export const CAR_FRAMES = 1;
/** Frames in `assets/pan/`. */
export const PAN_FRAMES = 1;
/** Frames in `assets/raft/`: the three-tile raft, then the four-tile raft. */
export const RAFT_FRAMES = 2;

/** The source width of one plow frame. */
export const PLOW_W = 96;
/** The source width of one dogsled frame. */
export const DOGSLED_W = 64;
/** The source width of one car frame. */
export const CAR_W = 64;
/** The source width of one pan frame. */
export const PAN_W = 32;
/** The source width of one raft frame; the three-tile raft is its left 96. */
export const RAFT_W = 128;

// ---- Screen copy (specs/ui.md) -------------------------------------------

/** The title. */
export const TITLE_TEXT = "FLOE";
/** The tagline under it. */
export const TAGLINE_TEXT = "DON'T LOOK BACK";
/** The title screen's menu, in order. */
export const TITLE_ITEMS: readonly string[] = ["CROSS", "HOW TO PLAY"];
/** The pause menu, in order. */
export const PAUSE_ITEMS: readonly string[] = [
  "RESUME",
  "RESTART",
  "QUIT TO MENU",
];
/** Both end screens' menu, in order. */
export const ENDING_ITEMS: readonly string[] = ["PLAY AGAIN", "MENU"];
/** The label the HUD's level readout carries. */
export const HUD_LEVEL_LABEL = "LEVEL";

// ---- The debug surface (specs/instrumentation.md) ------------------------

/** The version `window.__floe.version` reports. */
export const FLOE_DEBUG_VERSION = 1;

// ---- Input (specs/controls.md) -------------------------------------------
//
// Under `none` there are no named actions in the specification: the game answers
// to physical keys, read as `KeyboardEvent.code`. This build still names its own
// actions, because the runtime layer beneath the game is where a key becomes an
// intent, and the game asks for the intent.

/** The intents the game reads, and the `KeyboardEvent.code` values driving each. */
export const BINDINGS = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP", "Escape"],
  mute: ["KeyM"],
} as const satisfies Record<string, readonly string[]>;

/** An intent the game reads. */
export type ActionName = keyof typeof BINDINGS;

/** Every intent, in the order they are registered. */
export const ACTIONS = Object.keys(BINDINGS) as ActionName[];

// ---- Audio (specs/ui.md) -------------------------------------------------

/** The ten cues, one per event. */
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

/** One of the ten cue names. */
export type CueName = (typeof CUES)[keyof typeof CUES];
