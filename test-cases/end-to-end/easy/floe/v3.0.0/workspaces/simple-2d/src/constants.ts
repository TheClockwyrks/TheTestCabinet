// Floe — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down). That space is the
// engine's logical design size: the engine scales and letterboxes it onto the
// canvas, so no value here is ever expressed in real pixels and gameplay never
// leaves logical space. ONE COORDINATE SYSTEM, and it is the stage's: the tile
// map below folds the strait's own offset in, so nothing in the build ever
// measures from the top of the strait.
//
// The critter's and a bear's position is that entity's CENTRE. A lane item is a
// span rather than a point, so its `x` is its LEFT EDGE and it covers
// `[x, x + TILE * len)`. `specs/overview.md` states the convention and
// `specs/instrumentation.md` restates it beside the snapshot shape.
//
// Every rate below is PER SECOND. The simulation itself runs on a FIXED STEP of
// `TICK_DT` seconds (`specs/overview.md`): a frame runs as many whole ticks as
// its elapsed time completes and carries the remainder, so a rate is integrated
// against `TICK_DT` rather than against the frame's own delta.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Floe fixes no palette, no font,
// no HUD layout, no animation rate and no background. There is not a single
// colour or type face in this file, and there is not meant to be one.
// `specs/overview.md` states what a player has to be able to read at a glance —
// the five bands apart, deep water apart from a floe, an open bay apart from the
// shore, the critter and the bear apart from what they stand on — and how the
// strait looks is the build's to design. The one colour value the project carries
// is `BACKGROUND`, which the build exports from `src/game.ts` because the build
// chooses it. The frame rate a sprite's frames alternate at is the build's for the
// same reason: `specs/assets.md` says which frames alternate for which state and
// that they cycle at a rate that reads as motion, and leaves the figure open.

// ---- Stage (specs/overview.md) -------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

// ---- The strait (specs/strait.md) ----------------------------------------

/** The HUD bar spans the full width above the strait, `y` in `[0, HUD_H]`. */
export const HUD_H = 80;

/** The strait itself, beneath the HUD bar: `y` in `[STRAIT_TOP, STRAIT_TOP + STRAIT_H]`. */
export const STRAIT_TOP = 80;
export const STRAIT_W = 1280;
export const STRAIT_H = 640;

/** The strait is a grid of square tiles: `COLS` across by `ROWS` down. */
export const TILE = 32;
export const COLS = 40;
export const ROWS = 20;

/**
 * The tile-to-stage map, stated in `specs/strait.md` and named here so nothing in
 * the build derives it a second time. `tileLeft` and `tileTop` give a tile's
 * top-left corner; `tileCX` and `tileCY` give its centre, which is where an
 * entity standing on it is reported. `colAt` and `rowAt` invert them, which is
 * how a drifting critter's column follows its centre.
 */
export function tileLeft(c: number): number {
  return TILE * c;
}

export function tileTop(r: number): number {
  return STRAIT_TOP + TILE * r;
}

export function tileCX(c: number): number {
  return TILE * c + TILE / 2;
}

export function tileCY(r: number): number {
  return STRAIT_TOP + TILE * r + TILE / 2;
}

export function colAt(x: number): number {
  return Math.floor(x / TILE);
}

export function rowAt(y: number): number {
  return Math.floor((y - STRAIT_TOP) / TILE);
}

/** Whether a tile lies on the strait at all. */
export function inBounds(c: number, r: number): boolean {
  return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

// ---- The five bands (specs/strait.md) ------------------------------------

/** The far shore: row 0 is solid cap, row 1 holds the five bays. */
export const ROW_CAP = 0;
export const ROW_BAYS = 1;

/** The water band, rows `WATER_TOP..WATER_BOTTOM` inclusive. */
export const WATER_TOP = 2;
export const WATER_BOTTOM = 9;

/** The median shelf: solid footing carrying no lane. */
export const ROW_MEDIAN = 10;

/** The ice band, rows `ICE_TOP..ICE_BOTTOM` inclusive. */
export const ICE_TOP = 11;
export const ICE_BOTTOM = 18;

/** The near shore: solid footing, and where a crossing begins. */
export const ROW_NEAR = 19;

/** The column a fresh critter starts on. */
export const START_COL = 20;

/**
 * The five bays, left to right, each an exact PAIR of columns in row
 * `ROW_BAYS`. Every other column of that row is solid far shore. The pairs are
 * exact rather than approximate, so nothing in the build or the specification has
 * a tile of latitude to interpret.
 */
export const BAYS: readonly (readonly [number, number])[] = [
  [3, 4],
  [11, 12],
  [19, 20],
  [27, 28],
  [35, 36],
];

export const BAY_COUNT = 5;

// ---- The fixed step (specs/overview.md) ----------------------------------

/** The simulation runs at `TICK_HZ` whole ticks a second, each of `TICK_DT`. */
export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;

// ---- The critter (specs/hopping.md) --------------------------------------

/**
 * The seconds between one accepted hop and the next. A held direction
 * auto-repeats at this interval; a press inside it does nothing.
 */
export const HOP_COOLDOWN = 0.12;

// ---- The lanes (specs/ice.md, specs/water.md) ----------------------------

/** How many tiles each kind of lane item spans. */
export const ITEM_LEN: Readonly<Record<string, number>> = {
  plow: 3,
  dogsled: 2,
  car: 2,
  pan: 1,
  raft3: 3,
  raft4: 4,
};

/**
 * A lane: the strait row it occupies, the one kind of item it carries, the
 * direction it runs (`1` rightward, `-1` leftward), its level-1 speed in tiles
 * per second, and the gap in tiles it leaves between consecutive items.
 */
export interface LaneSpec {
  readonly row: number;
  readonly kind: string;
  readonly dir: 1 | -1;
  readonly speed: number;
  readonly gap: number;
}

/** The eight ice lanes, rows `ICE_TOP..ICE_BOTTOM` ascending. */
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

/** The eight water lanes, rows `WATER_TOP..WATER_BOTTOM` ascending. */
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

/**
 * How a lane hardens with the level: every lane runs `LEVEL_SPEED_STEP` faster
 * per level, and every lane's gap widens by one tile every `LEVEL_GAP_EVERY`
 * levels. A widening gap is what keeps a faster lane crossable.
 */
export const LEVEL_SPEED_STEP = 1.06;
export const LEVEL_GAP_EVERY = 3;

function laneAt(row: number): LaneSpec {
  const lane = [...ICE_LANES, ...WATER_LANES].find((l) => l.row === row);
  if (!lane) throw new Error(`Floe: row ${row} carries no lane`);
  return lane;
}

export function laneSpeed(row: number, level: number): number {
  return laneAt(row).speed * Math.pow(LEVEL_SPEED_STEP, level - 1);
}

export function laneGap(row: number, level: number): number {
  return laneAt(row).gap + Math.floor((level - 1) / LEVEL_GAP_EVERY);
}

// ---- The hunter (specs/hunter.md) ----------------------------------------

/**
 * A bear's two travel speeds at level 1, in tiles per second, and the per-level
 * step both climb by. Ice footing is the ice band, the median, the near shore and
 * a floe; swim speed applies over open water alone.
 */
export const BEAR_ICE_SPEED = 3.0;
export const BEAR_SWIM_SPEED = 2.0;
export const BEAR_SPEED_STEP = 1.06;

export function bearIceSpeed(level: number): number {
  return BEAR_ICE_SPEED * Math.pow(BEAR_SPEED_STEP, level - 1);
}

export function bearSwimSpeed(level: number): number {
  return BEAR_SWIM_SPEED * Math.pow(BEAR_SPEED_STEP, level - 1);
}

/**
 * When the hunt begins: the rows the critter must have climbed off the near
 * shore, and the seconds of crossing that must have passed, before the first
 * bear emerges. The second bear waits a further `BEAR_SECOND_ADVANCE` rows and
 * `BEAR_SECOND_DELAY` seconds on top of the first's.
 */
export const BEAR_EMERGE_ADVANCE = 3;
export const BEAR_EMERGE_DELAY = 0.6;
export const BEAR_SECOND_ADVANCE = 3;
export const BEAR_SECOND_DELAY = 1.4;

/**
 * How close a bear's centre must come to the critter's to catch it, in stage
 * units, and the look-ahead a tile is treated as closed within: a bear will not
 * step into a tile a moving vehicle will cover inside `BEAR_AVOID_LEAD` seconds.
 */
export const BEAR_CATCH_DIST = 18;
export const BEAR_AVOID_LEAD = 0.35;

/** The level a second bear joins the hunt, and the most that ever hunt at once. */
export const SECOND_BEAR_LEVEL = 5;
export const MAX_BEARS = 2;

// ---- The run (specs/progression.md) --------------------------------------

/** The lives a run opens with, counting the critter currently crossing. */
export const START_LIVES = 3;

/** The levels a full run has. Clearing the last one wins. */
export const TOTAL_LEVELS = 8;

/**
 * The seconds a crossing gets, shortening with the level:
 *
 *   crossingTimer(level) =
 *     max(TIMER_MIN, TIMER_BASE - (level - 1) * TIMER_PER_LEVEL)
 *
 * Level 1 is 30 s and level 8 is 16 s. `TIMER_MIN` is a stated bound rather than
 * a figure the eight-level run reaches.
 */
export const TIMER_BASE = 30;
export const TIMER_PER_LEVEL = 2;
export const TIMER_MIN = 15;

export function crossingTimer(level: number): number {
  return Math.max(TIMER_MIN, TIMER_BASE - (level - 1) * TIMER_PER_LEVEL);
}

/**
 * The three pauses the run holds on: after a death before the respawn, after a
 * level is cleared before the next opens, and after a bay is filled before the
 * fresh crossing begins.
 */
export const DEATH_PAUSE = 0.9;
export const CLEAR_PAUSE = 1.6;
export const BAYFILL_PAUSE = 0.5;

/** A bonus life at every boundary the score crosses through play. */
export const BONUS_LIFE_EVERY = 10000;

// ---- The bonus catch (specs/bays.md) -------------------------------------

/** How long a bonus catch lingers in its bay, and how often the next arrives. */
export const FISH_LINGER = 5;
export const FISH_INTERVAL = 8;

// ---- Scoring (specs/scoring.md) ------------------------------------------

/** Per row newly reached this crossing, including the bay row. */
export const SCORE_ROW = 10;

/** On filling a bay. */
export const SCORE_BAY = 50;

/** Per whole second left on the crossing timer when a bay is filled. */
export const SCORE_TIME_BONUS = 2;

/** Times the level, on clearing it. */
export const SCORE_LEVEL = 100;

/** Per remaining life, at victory. */
export const SCORE_VICTORY_LIFE = 250;

/** For completing a crossing into the bay holding the bonus catch. */
export const SCORE_BONUS_CATCH = 200;

// ---- The seeded sprite art (specs/assets.md) -----------------------------

/** One tile of a sprite sheet is this square, with a transparent background. */
export const SPRITE_TILE = 32;

/** How many frames each folder holds. */
export const CROSSER_FRAMES = 8;
export const BEAR_FRAMES = 18;
export const PLOW_FRAMES = 1;
export const DOGSLED_FRAMES = 1;
export const CAR_FRAMES = 1;
export const PAN_FRAMES = 1;
export const RAFT_FRAMES = 2;

/**
 * How wide each lane item's art is, in stage units — `SPRITE_TILE` per tile the
 * item spans. `RAFT_W` is the width of `assets/raft/1.png`, the four-tile raft;
 * the three-tile raft is the left `96 x 32` of `assets/raft/0.png`.
 */
export const PLOW_W = 96;
export const DOGSLED_W = 64;
export const CAR_W = 64;
export const PAN_W = 32;
export const RAFT_W = 128;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "FLOE";
export const TAGLINE_TEXT = "DON'T LOOK BACK";

export const TITLE_ITEMS = ["CROSS", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const ENDING_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/**
 * The one HUD label the specification fixes. How the bar is composed around it —
 * a slash, the word OF, the label above the digits — is the build's.
 */
export const HUD_LEVEL_LABEL = "LEVEL";

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * Floe needs four-way movement and no action button, and this is the catalogue
 * layout that carries exactly that.
 */
export const LAYOUT = "dpad-4";

/** Every action Floe registers: the layout's movement pad, plus the menu and system vocabulary. */
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

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character. `specs/controls.md`
 * states the same table in prose.
 *
 * `Escape` deliberately drives two actions: it pauses a live crossing, and it
 * goes back out of whatever screen is in front of the player.
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

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The ten cues the game plays, named once here and defined against these names. */
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

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- The debug surface (specs/instrumentation.md) ------------------------

/** The version the debug surface reports as `version`. */
export const FLOE_DEBUG_VERSION = 1;

/** The seed a run uses when `reset()` is called without one. */
export const DEFAULT_SEED = 1;
