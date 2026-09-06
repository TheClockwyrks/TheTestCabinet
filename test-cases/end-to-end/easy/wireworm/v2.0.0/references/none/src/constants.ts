// Wireworm — every figure the specification fixes, named once.
//
// The specs under `specs/` state each of these under the name it carries here,
// so no number anywhere else in this build is a guess and no spec value is left
// to interpretation. Anything the specification does not name is a choice, and
// the choices about the LOOK live in `src/theme.ts` instead: this file holds no
// color, no font, and no layout, exactly as `specs/overview.md` leaves them to
// the build.
//
// Every value is in the fixed 1280x720 logical space `specs/overview.md`
// defines (origin top-left, x right, y down), and every position the game takes
// or reports is a CENTER. Every rate is PER SECOND and is integrated against the
// delta time the frame hands the game; the one clocked quantity is the worm's
// tile step, which accumulates that same delta with the carry rule
// `specs/worm.md` states.

// ---- Stage (specs/overview.md) -------------------------------------------

/** The logical design size the runtime fits onto the canvas. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

// ---- Board geometry (specs/board.md) -------------------------------------

/** The HUD bar spans the full width above the board, `y` in `[0, HUD_H]`. */
export const HUD_H = 80;

/** The board itself, beneath the HUD bar: `y` in `[BOARD_Y, BOARD_Y + BOARD_H]`. */
export const BOARD_Y = 80;
export const BOARD_W = 1280;
export const BOARD_H = 640;

/** The board is a grid of square tiles: `COLS` across by `ROWS` down. */
export const TILE = 32;
export const COLS = 40;
export const ROWS = 20;

/** The row a level's worm enters along. */
export const ENTRY_ROW = 0;

/**
 * The player band: the bottom two rows of the grid, which the cursor is confined
 * to and which no scattered node is laid in.
 */
export const BAND_TOP_ROW = 18;
export const BAND_TOP_Y = 656;

/**
 * The tile-to-stage map `specs/board.md` owns. `tileLeft` and `tileTop` give a
 * tile's top-left corner; `tileCX` and `tileCY` give its center, which is where
 * an entity standing on it is reported.
 */
export function tileLeft(c: number): number {
  return TILE * c;
}

export function tileTop(r: number): number {
  return BOARD_Y + TILE * r;
}

export function tileCX(c: number): number {
  return TILE * c + TILE / 2;
}

export function tileCY(r: number): number {
  return BOARD_Y + TILE * r + TILE / 2;
}

/** The inverse: the tile a center falls in. */
export function colAt(x: number): number {
  return Math.floor(x / TILE);
}

export function rowAt(y: number): number {
  return Math.floor((y - BOARD_Y) / TILE);
}

/** Whether a tile lies on the board at all. */
export function inBounds(c: number, r: number): boolean {
  return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

// ---- The starting scatter (specs/nodes.md) -------------------------------

/**
 * A new run scatters inert nodes across rows `SCATTER_TOP_ROW..SCATTER_BOTTOM_ROW`
 * inclusive — never row 0, which the worm enters along, and never the band. The
 * count is a fraction of the tiles those rows hold, drawn from the run's seeded
 * generator.
 */
export const SCATTER_TOP_ROW = 1;
export const SCATTER_BOTTOM_ROW = 17;
export const SCATTER_MIN_FRACTION = 0.1;
export const SCATTER_MAX_FRACTION = 0.15;

// ---- The data-worm (specs/worm.md) ---------------------------------------

/**
 * The worm's step interval, in seconds, quickening one level at a time:
 *
 *   wormStepInterval(level) =
 *     max(WORM_STEP_FLOOR, WORM_STEP_L1 * WORM_STEP_DECAY ^ (level - 1))
 *
 * The floor is a stated bound rather than a figure the run reaches: level 12 is
 * 0.0796 s, and the expression would first cross 0.07 at level 15.
 */
export const WORM_STEP_L1 = 0.14;
export const WORM_STEP_DECAY = 0.95;
export const WORM_STEP_FLOOR = 0.07;

export function wormStepInterval(level: number): number {
  return Math.max(
    WORM_STEP_FLOOR,
    WORM_STEP_L1 * Math.pow(WORM_STEP_DECAY, level - 1),
  );
}

/** The level's worm carries `WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1)` segments. */
export const WORM_BASE_LENGTH = 10;
export const WORM_LENGTH_PER_LEVEL = 2;

export function wormLength(level: number): number {
  return WORM_BASE_LENGTH + WORM_LENGTH_PER_LEVEL * (level - 1);
}

// ---- Charge and discharge (specs/nodes.md, specs/discharge.md) -----------

/** A node's charge runs 0 (inert) to CHARGE_MAX (critical). */
export const CHARGE_MAX = 3;

/** A detonation arcs to every charged node within this Chebyshev radius, in tiles. */
export const DISCHARGE_RADIUS = 2;

/** How long, in seconds, a conducted arc is reported and drawn for. */
export const ARC_LIFE = 0.32;

// ---- The cursor and its bolts (specs/cursor.md) --------------------------

/** How fast a held movement action slides the cursor, in logical units per second. */
export const CURSOR_SPEED = 430;

/** The cursor's half-extent, which decides a contact and sets a bolt's muzzle. */
export const CURSOR_HALF = 12;

/**
 * The bounds the cursor's CENTER is clamped to. The band is only 32 units tall —
 * the bottom two rows of the grid — so the cursor crosses it in 0.074 s at
 * `CURSOR_SPEED`.
 */
export const CURSOR_X_MIN = 16;
export const CURSOR_X_MAX = 1264;
export const CURSOR_Y_MIN = 672;
export const CURSOR_Y_MAX = 704;

/** Firing: the interval between bolts while the action is held, the cap in flight, and their speed. */
export const FIRE_INTERVAL = 0.15;
export const MAX_BOLTS = 3;
export const BOLT_SPEED = 900;

// ---- The run (specs/progression.md) --------------------------------------

export const START_LIVES = 3;
export const TOTAL_LEVELS = 12;

/** A bonus life at every multiple of this figure crossed through play. */
export const BONUS_LIFE_EVERY = 12000;

/** The phase timers, in seconds: the level banner, the respawn, and the invulnerability that follows it. */
export const BANNER_TIME = 1.3;
export const RESPAWN_TIME = 1.4;
export const RESPAWN_INVULN = 2.0;

// ---- Scoring (specs/scoring.md) ------------------------------------------

export const SCORE_BODY = 10;
export const SCORE_HEAD = 100;
export const SCORE_FRY = 10;
export const SCORE_PURGE_NODE = 5;
export const SCORE_INERT_NODE = 1;
export const SCORE_GLITCH = 300;
export const SCORE_DROPPER = 200;
export const SCORE_CORRUPTOR = 1000;

/** The level-clear bonus is `SCORE_LEVEL_CLEAR * level`; victory pays `SCORE_VICTORY * lives`. */
export const SCORE_LEVEL_CLEAR = 100;
export const SCORE_VICTORY = 250;

// ---- The support foes (specs/foes.md) ------------------------------------

/** A foe's half-extent, which decides a contact with the cursor and a bolt's hit. */
export const FOE_HALF = 12;

/** The glitch: the level it starts at, how many share the board, and how often one arrives. */
export const GLITCH_FROM_LEVEL = 2;
export const GLITCH_MAX_ON_BOARD = 2;
export const GLITCH_MIN_INTERVAL = 7.0;
export const GLITCH_MAX_INTERVAL = 12.0;

/**
 * The glitch's motion: it sweeps horizontally at `GLITCH_H_SPEED`, descends
 * steadily at `GLITCH_V_SPEED`, and reverses its horizontal direction at each
 * `GLITCH_DART_INTERVAL`.
 */
export const GLITCH_H_SPEED = 210;
export const GLITCH_V_SPEED = 62;
export const GLITCH_DART_INTERVAL = 0.32;

/** The rows a glitch enters on, inclusive. */
export const GLITCH_ENTRY_TOP_ROW = 8;
export const GLITCH_ENTRY_BOTTOM_ROW = 15;

/**
 * The dropper: the level it starts at, how sparse the lower field has to be to
 * draw one in, and how often that is checked.
 */
export const DROPPER_FROM_LEVEL = 3;
export const DROPPER_SPARSE_THRESHOLD = 8;
export const DROPPER_CHECK_INTERVAL = 2.5;

/** The rows the sparse-field check counts nodes over, inclusive. */
export const DROPPER_COUNT_TOP_ROW = 10;
export const DROPPER_COUNT_BOTTOM_ROW = 19;

/** How fast a dropper falls, before and after its first bolt. */
export const DROPPER_SPEED = 150;
export const DROPPER_SPEED_HIT = 320;

/** The corruptor: the level it starts at, how often one arrives, and how fast it crawls. */
export const CORRUPTOR_FROM_LEVEL = 5;
export const CORRUPTOR_MIN_INTERVAL = 14.0;
export const CORRUPTOR_MAX_INTERVAL = 22.0;
export const CORRUPTOR_SPEED = 130;

/** The rows a corruptor enters on, inclusive. */
export const CORRUPTOR_ENTRY_TOP_ROW = 1;
export const CORRUPTOR_ENTRY_BOTTOM_ROW = 6;

// ---- The seeded sprite art (specs/assets.md) -----------------------------

/** Every frame under `assets/` is this square, with a transparent background. */
export const SPRITE_SIZE = 32;

/** How many frames each folder holds. */
export const NODE_FRAMES = 5;
export const WORM_FRAMES = 6;
export const CURSOR_FRAMES = 1;
export const GLITCH_FRAMES = 4;
export const DROPPER_FRAMES = 1;
export const CORRUPTOR_FRAMES = 4;

/** The rate, in frames per second, each animated element is played back at. */
export const NODE_PULSE_FPS = 6;
export const WORM_HEAD_FPS = 5;
export const WORM_BODY_FPS = 6;
export const GLITCH_FPS = 10;
export const CORRUPTOR_FPS = 8;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "WIREWORM";
export const TAGLINE_TEXT = "CUT THE CURRENT";

export const TITLE_ITEMS = ["DESCEND", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const ENDING_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/**
 * The one HUD label the specification fixes. How the bar is composed around it
 * is the build's.
 */
export const HUD_LEVEL_LABEL = "LEVEL";

// ---- Input actions (specs/controls.md) -----------------------------------

/** Every action Wireworm answers to. */
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
 * Two keys deliberately drive two actions each: `Space` fires and confirms, and
 * `Escape` pauses and goes back. The screen decides which one applies.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  a: ["Space"],
  b: ["Space"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP", "Escape"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The ten cues the game plays, named once here and defined against these names. */
export const CUES = {
  fire: "fire",
  cut: "cut",
  discharge: "discharge",
  critical: "critical",
  foe: "foe",
  life: "life",
  levelClear: "level-clear",
  victory: "victory",
  gameOver: "game-over",
  menu: "menu",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- The debug surface (specs/instrumentation.md) ------------------------

/** The version the debug surface reports as `version`. */
export const WIREWORM_DEBUG_VERSION = 1;
