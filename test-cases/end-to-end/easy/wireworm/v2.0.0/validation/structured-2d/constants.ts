// Wireworm — every figure the specification fixes, restated on the validator's
// side. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS AT ALL. A structured-2d run DOES seed the build a
// `src/constants.ts`, carrying these same figures under these same names, and a
// check here could import it. Nothing here ever does. A check that read a figure
// out of the build's own tree would compare the build against its own copy of
// that number, and that grades nothing: the comparison becomes "does the build
// do what the build says it does", which holds for every build, including one
// whose figure is wrong. The build is free to edit that file; a build that set
// `SCORE_HEAD` to 50 and paid 50 would pass a check that read 50 from it.
//
// Everything below is therefore read out of `specs/` and written here, under the
// name the specification gives it, so a check asserts the CASE's figure against
// the BUILD's behaviour. This file is the project's only source of a graded
// figure, and the projects for the other engines carry their own copy of it.
//
// NOTHING HERE IS EVER READ FROM A BUILD, and nothing here is a tolerance. The
// figures are the specification's; the tolerance a check allows around one is
// the check's own business and is stated in the check, beside the figure it is a
// tolerance on (`guides/authoring/writing-debug-apis-and-validators.md`). A
// helper that carried a threshold would hide what the check is really asserting,
// so this file carries none — not a colour distance, not a percentage, not a
// frame budget.
//
// Every value is in the fixed 1280x720 logical space `specs/overview.md` fixes
// (origin top-left, x right, y down), and every position the surface takes or
// reports is an entity's CENTER.

/* -------------------------------------------------------------------------- */
/* The stage (specs/overview.md)                                              */
/* -------------------------------------------------------------------------- */

/** The logical design size every build fits onto its canvas. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/* -------------------------------------------------------------------------- */
/* The board (specs/board.md)                                                 */
/* -------------------------------------------------------------------------- */

/** The HUD bar spans the full width above the board, `y` in `[0, HUD_H]`. */
export const HUD_H = 80;

/** The board itself, beneath the HUD bar: `y` in `[BOARD_Y, BOARD_Y + BOARD_H]`. */
export const BOARD_Y = 80;
export const BOARD_W = 1280;
export const BOARD_H = 640;

/** The board is a grid of square tiles, `COLS` across by `ROWS` down. */
export const TILE = 32;
export const COLS = 40;
export const ROWS = 20;

/** The row a level's worm enters along. */
export const ENTRY_ROW = 0;

/** The player band: the bottom two rows, which the cursor is confined to. */
export const BAND_TOP_ROW = 18;
export const BAND_TOP_Y = 656;

/** A tile's top-left corner on the stage. */
export function tileLeft(c: number): number {
  return TILE * c;
}

export function tileTop(r: number): number {
  return BOARD_Y + TILE * r;
}

/**
 * A tile's CENTER on the stage — where an entity standing on it is reported, and
 * what a caller aiming at a tile passes to `setCursor`, `addBolt` or `addFoe`.
 */
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

/* -------------------------------------------------------------------------- */
/* The node field (specs/nodes.md)                                            */
/* -------------------------------------------------------------------------- */

/** A node's charge runs `0` (inert) to `CHARGE_MAX` (critical). */
export const CHARGE_MAX = 3;

/** The rows a new run scatters nodes across, inclusive, and how densely. */
export const SCATTER_TOP_ROW = 1;
export const SCATTER_BOTTOM_ROW = 17;
export const SCATTER_MIN_FRACTION = 0.1;
export const SCATTER_MAX_FRACTION = 0.15;

/** The tiles those rows hold between them: `680`, as `specs/nodes.md` states. */
export const SCATTER_TILES = COLS * (SCATTER_BOTTOM_ROW - SCATTER_TOP_ROW + 1);

/* -------------------------------------------------------------------------- */
/* The chain-arc discharge (specs/discharge.md)                               */
/* -------------------------------------------------------------------------- */

/** A detonation arcs to every charged node within this Chebyshev radius, in tiles. */
export const DISCHARGE_RADIUS = 2;

/** How long, in seconds, a conducted arc is reported and drawn for. */
export const ARC_LIFE = 0.32;

/* -------------------------------------------------------------------------- */
/* The data-worm (specs/worm.md)                                              */
/* -------------------------------------------------------------------------- */

/**
 * The worm's step interval, in seconds:
 *
 *   wormStepInterval(level) =
 *     max(WORM_STEP_FLOOR, WORM_STEP_L1 * WORM_STEP_DECAY ^ (level - 1))
 *
 * The floor is a stated bound the twelve levels of a run never reach: level 12
 * is `0.0796` s, and the expression would first cross `0.07` at level 15.
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

/* -------------------------------------------------------------------------- */
/* The cursor and its bolts (specs/cursor.md)                                 */
/* -------------------------------------------------------------------------- */

/** How fast a held movement action slides the cursor, in logical units per second. */
export const CURSOR_SPEED = 430;

/** The cursor's half-extent, which decides a contact and sets a bolt's muzzle. */
export const CURSOR_HALF = 12;

/** The bounds the cursor's CENTER is clamped to. */
export const CURSOR_X_MIN = 16;
export const CURSOR_X_MAX = 1264;
export const CURSOR_Y_MIN = 672;
export const CURSOR_Y_MAX = 704;

/** The band's center, `(640, 688)`, where a run and a respawn place the cursor. */
export const BAND_CX = (CURSOR_X_MIN + CURSOR_X_MAX) / 2;
export const BAND_CY = (CURSOR_Y_MIN + CURSOR_Y_MAX) / 2;

/** Firing: the interval between bolts, the cap in flight, and a bolt's speed. */
export const FIRE_INTERVAL = 0.15;
export const MAX_BOLTS = 3;
export const BOLT_SPEED = 900;

/* -------------------------------------------------------------------------- */
/* The run (specs/progression.md)                                             */
/* -------------------------------------------------------------------------- */

export const START_LIVES = 3;
export const TOTAL_LEVELS = 12;

/** A bonus life at every multiple of this figure crossed through play. */
export const BONUS_LIFE_EVERY = 12000;

/** The phase timers, in seconds: the banner, the respawn, and the invulnerability. */
export const BANNER_TIME = 1.3;
export const RESPAWN_TIME = 1.4;
export const RESPAWN_INVULN = 2.0;

/* -------------------------------------------------------------------------- */
/* Scoring (specs/scoring.md)                                                 */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* The support foes (specs/foes.md)                                           */
/* -------------------------------------------------------------------------- */

/** A foe's half-extent, which decides a contact with the cursor and a bolt's hit. */
export const FOE_HALF = 12;

/** The glitch. */
export const GLITCH_FROM_LEVEL = 2;
export const GLITCH_MAX_ON_BOARD = 2;
export const GLITCH_MIN_INTERVAL = 7.0;
export const GLITCH_MAX_INTERVAL = 12.0;
export const GLITCH_H_SPEED = 210;
export const GLITCH_V_SPEED = 62;
export const GLITCH_DART_INTERVAL = 0.32;
export const GLITCH_ENTRY_TOP_ROW = 8;
export const GLITCH_ENTRY_BOTTOM_ROW = 15;

/** The dropper. */
export const DROPPER_FROM_LEVEL = 3;
export const DROPPER_SPARSE_THRESHOLD = 8;
export const DROPPER_CHECK_INTERVAL = 2.5;
export const DROPPER_COUNT_TOP_ROW = 10;
export const DROPPER_COUNT_BOTTOM_ROW = 19;
export const DROPPER_SPEED = 150;
export const DROPPER_SPEED_HIT = 320;

/** The corruptor. */
export const CORRUPTOR_FROM_LEVEL = 5;
export const CORRUPTOR_MIN_INTERVAL = 14.0;
export const CORRUPTOR_MAX_INTERVAL = 22.0;
export const CORRUPTOR_SPEED = 130;
export const CORRUPTOR_ENTRY_TOP_ROW = 1;
export const CORRUPTOR_ENTRY_BOTTOM_ROW = 6;

/* -------------------------------------------------------------------------- */
/* The seeded sprite art (specs/assets.md)                                    */
/* -------------------------------------------------------------------------- */

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

/** The six folders `specs/assets.md` seeds, with the frames each holds. */
export const SPRITE_SHEETS = {
  node: { folder: "node", frames: NODE_FRAMES },
  worm: { folder: "worm", frames: WORM_FRAMES },
  cursor: { folder: "cursor", frames: CURSOR_FRAMES },
  glitch: { folder: "glitch", frames: GLITCH_FRAMES },
  dropper: { folder: "dropper", frames: DROPPER_FRAMES },
  corruptor: { folder: "corruptor", frames: CORRUPTOR_FRAMES },
} as const;

/** The name of one seeded sheet. */
export type SheetName = keyof typeof SPRITE_SHEETS;

/**
 * Which frames of `assets/worm/` cover which part of a chain
 * (`specs/assets.md`): a two-frame pair each for the head, the body, and the
 * tail, in that order.
 */
export const WORM_HEAD_FRAMES: readonly number[] = [0, 1];
export const WORM_BODY_FRAMES: readonly number[] = [2, 3];
export const WORM_TAIL_FRAMES: readonly number[] = [4, 5];

/** The two frames of `assets/node/` a critical node alternates between. */
export const NODE_CRITICAL_FRAMES: readonly number[] = [3, 4];

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/ui.md)                                                  */
/* -------------------------------------------------------------------------- */

export const TITLE_TEXT = "WIREWORM";
export const TAGLINE_TEXT = "CUT THE CURRENT";

export const TITLE_ITEMS = ["DESCEND", "HOW TO PLAY"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const ENDING_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/** The one HUD label the specification fixes. */
export const HUD_LEVEL_LABEL = "LEVEL";

/** The standalone words `specs/ui.md` requires the how-to screen to name. */
export const HOWTO_FIRE_KEY = "SPACE";
export const HOWTO_MOVE_KEYS = ["ARROWS", "WASD"] as const;

/* -------------------------------------------------------------------------- */
/* Input (specs/controls.md)                                                  */
/* -------------------------------------------------------------------------- */

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
 * The keys each action is bound to, as `KeyboardEvent.code` values, so a
 * binding is a physical key rather than a layout-dependent character.
 *
 * `Space` drives both fire and confirm, and `Escape` both pause and back; the
 * screen decides which one applies.
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

/** The key the read-only debug overlay is shown and hidden by. */
export const OVERLAY_KEY = "Backquote";

/**
 * A key `specs/controls.md` binds to nothing.
 *
 * Pressing it is a real key press that touches nothing the game answers to, so a
 * check that needs a gesture without a consequence has one to send.
 */
export const UNBOUND_KEY = "KeyZ";

/* -------------------------------------------------------------------------- */
/* The touch layout (specs/controls.md)                                       */
/* -------------------------------------------------------------------------- */

/**
 * The touch layout the game registers its actions on.
 *
 * `specs/controls.md` names it outright — "the game registers the layout
 * `LAYOUT` (`dpad-4-two-buttons`), which carries four-way movement and two
 * buttons" — so it is the case's figure and not the build's to pick. The harness
 * states it when it stands the engine up rather than asking the build which
 * layout it chose, and a build that registered another one fails.
 */
export const LAYOUT = "dpad-4-two-buttons";

/* -------------------------------------------------------------------------- */
/* Audio (specs/ui.md)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The ten cues, under the names `specs/ui.md` gives them.
 *
 * Under structured-2d the engine owns the audio bus, so a cue's NAME is observable:
 * a check reads which cue was emitted and on which driven frame. `specs/ui.md`
 * fixes every name below, so a build that played some other name for an event
 * fails the point rather than moving the target.
 */
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

/* -------------------------------------------------------------------------- */
/* The debug surface (specs/instrumentation.md)                               */
/* -------------------------------------------------------------------------- */

/** The version the surface reports as `version`. */
export const WIREWORM_DEBUG_VERSION = 1;

/** The seed a run uses when `reset()` is called without one. */
export const DEFAULT_SEED = 1;
