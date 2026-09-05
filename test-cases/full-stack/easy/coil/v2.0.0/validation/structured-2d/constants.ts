// Coil — the figures this case's specification fixes. CASE-PROVIDED.
//
// This file is the validator's side of every number a check compares a build
// against, and it exists because the other side is not usable. Under an engine
// the case SEEDS the build a `src/constants.ts` carrying the same figures, so a
// check could import the build's own copy — and a check that did would grade
// nothing at all. The comparison would become "does the build do what the build
// says it does", which holds for every build, including one whose figure is
// wrong: a build that scored a pellet at seven would pass a check that read
// `PELLET_POINTS` out of the build's table, because that table says seven too.
//
// So every value below is transcribed from the SEEDED SPECIFICATION the build was
// given, under the name that specification uses, and nothing here is read from a
// build. `src/constants.ts` is never imported by this project, by this file or by
// any other. The pairing is deliberate — `TICK_SECONDS` here is
// `specs/movement.md`'s tick, and a build that ticks at some other rate fails the
// point rather than moving the target.
//
// ONE PROJECT, BOTH VARIANTS. A run stages this project by ENGINE, and either
// variant's build may be on the other side of it, so the three figures
// `specs/mode.md` renders per variant — the mode's label, its title entry, and
// its obstacle course — are keyed by MODE here and a check reads the one
// `snapshot().mode` names. There is no variant to branch on at the file level.
//
// Positions are in the logical units of `specs/overview.md` (a fixed
// `STAGE_W x STAGE_H` stage, origin top-left, x right, y down) except where a
// figure is named as a CELL, which is the integer grid coordinate
// `specs/board.md` defines. Every duration is in seconds.

import type { Cell, Dir, Mode, Screen } from "./surface";

export type { Cell, Dir, Mode, Screen };

// ---- The stage (specs/overview.md) ------------------------------------------

export const STAGE_W = 1280;
export const STAGE_H = 720;

// ---- The board (specs/board.md) ---------------------------------------------

/** Columns of the grid, including the one-cell wall border. */
export const GRID_COLS = 30;
/** Rows of the grid, including the one-cell wall border. */
export const GRID_ROWS = 18;
/** The side of one cell, in logical units. */
export const CELL = 32;
/** The logical x of the top-left corner of cell `(0, 0)`. */
export const BOARD_X = 160;
/** The logical y of the top-left corner of cell `(0, 0)`. */
export const BOARD_Y = 120;

/** The board's logical extent: `960 x 576`, spanning x [160, 1120], y [120, 696]. */
export const BOARD_W = GRID_COLS * CELL;
export const BOARD_H = GRID_ROWS * CELL;

/**
 * The interior the one-cell border encloses, inclusive on both ends.
 *
 * `specs/board.md` puts the border on row `0`, row `GRID_ROWS - 1`, column `0`
 * and column `GRID_COLS - 1`, which leaves `col` in `[1, 28]` and `row` in
 * `[1, 16]` — the `28 x 16` a snake may fill.
 */
export const INTERIOR_COL_MIN = 1;
export const INTERIOR_COL_MAX = GRID_COLS - 2;
export const INTERIOR_ROW_MIN = 1;
export const INTERIOR_ROW_MAX = GRID_ROWS - 2;

/** Interior cells there are: `28 x 16`. */
export const INTERIOR_CELLS =
  (INTERIOR_COL_MAX - INTERIOR_COL_MIN + 1) *
  (INTERIOR_ROW_MAX - INTERIOR_ROW_MIN + 1);

/** The length the snake starts a round at (`START_LENGTH`). */
export const START_LENGTH = 3;

/** The starting chain, head first, laid horizontally near the board's center. */
export const START_CELLS: readonly Cell[] = [
  { col: 15, row: 8 },
  { col: 14, row: 8 },
  { col: 13, row: 8 },
];

/** The direction the snake starts a round facing. */
export const START_DIR: Dir = "right";

// ---- The tick and turning (specs/movement.md) -------------------------------

/** Seconds of simulation time one tick covers, so eight ticks a second. */
export const TICK_SECONDS = 0.125;

/** Ticks in one second of simulation time. */
export const TICKS_PER_SECOND = 1 / TICK_SECONDS;

/** The most steering requests the buffer holds at once. */
export const TURN_QUEUE_MAX = 2;

/** Every direction, in the order the specification lists them. */
export const DIRECTIONS: readonly Dir[] = ["up", "down", "left", "right"];

/** The cell displacement of one tick's travel in each direction. */
export const STEP: Readonly<Record<Dir, Cell>> = {
  up: { col: 0, row: -1 },
  down: { col: 0, row: 1 },
  left: { col: -1, row: 0 },
  right: { col: 1, row: 0 },
};

/** The direction that reverses `dir`, which step 1 discards. */
export const OPPOSITE: Readonly<Record<Dir, Dir>> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

// ---- Scoring (specs/scoring.md) ---------------------------------------------

/** The points one pellet is worth before the multiplier is applied. */
export const PELLET_POINTS = 10;

/** The ceiling on the combo multiplier M. */
export const COMBO_MAX = 5;

/** Seconds of simulation time a fully reopened combo window holds. */
export const COMBO_WINDOW = 3.5;

/**
 * Ticks a full combo window spans: `3.5 / 0.125`, which is 28.
 *
 * `specs/scoring.md` states it as 28 ticks of travel, so the tick the window
 * lapses on is stated by the specification rather than derived by a check.
 */
export const COMBO_WINDOW_TICKS = COMBO_WINDOW / TICK_SECONDS;

// ---- The debug surface (specs/instrumentation.md) ---------------------------

/** The version the surface reports, and the version the snapshot carries. */
export const COIL_DEBUG_VERSION = 1;

/** The seed `reset` uses when its caller names none. */
export const DEFAULT_SEED = 1;

// ---- The produced assets (specs/assets.md) ----------------------------------

/** Frames in the head sheet: the resting pose and the three of the bite. */
export const HEAD_FRAMES = 4;

/** Seconds the bite runs for before the head returns to frame `0`. */
export const BITE_SECONDS = 0.25;

/**
 * Every produced sprite, at the path `specs/assets.md` fixes for it.
 *
 * Written relative to the engine's one asset root, `assets/`, because that is
 * the form `specs/assets.md` has the build ask the loader for
 * (`snake/body.png`); a check that reads the file off disk prefixes the root
 * back on.
 */
export const SPRITE_PATHS = {
  head: [
    "snake/head/0.png",
    "snake/head/1.png",
    "snake/head/2.png",
    "snake/head/3.png",
  ],
  body: "snake/body.png",
  corner: "snake/corner.png",
  tail: "snake/tail.png",
} as const;

// ---- Screens (specs/ui.md) --------------------------------------------------

/** Every screen, in the order `specs/ui.md` tables them. */
export const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "playing",
  "paused",
  "gameover",
  "cleared",
];

/** The screens that carry a menu, and so a meaningful `menuIndex`. */
export const MENU_SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "paused",
  "gameover",
  "cleared",
];

// ---- Screen copy (specs/ui.md) ----------------------------------------------

export const TITLE_TEXT = "COIL";
export const TAGLINE_TEXT = "GRID SERPENT";
export const SCORE_LABEL = "SCORE";
export const BEST_LABEL = "BEST";
export const GAMEOVER_TEXT = "GAME OVER";
export const CLEARED_TEXT = "BOARD CLEARED";

/**
 * The title menu holds two items: the mode's entry, then `HOW TO PLAY`.
 *
 * The first is `specs/mode.md`'s `MODE_ITEM`, which is the mode's word and so
 * sits under {@link MODE_LABEL}; the second is the same on both modes.
 */
export const TITLE_ITEM_COUNT = 2;

/** The title menu's second item, and the index it sits at. */
export const HOWTO_ITEM = "HOW TO PLAY";
export const HOWTO_INDEX = 1;

export const PAUSE_ITEMS: readonly string[] = ["RESUME", "RESTART", "MENU"];

export const OVER_ITEMS: readonly string[] = ["PLAY AGAIN", "MENU"];

// ---- The mode (specs/mode.md) -----------------------------------------------

/** `MODE_ITEM` and `MODE_LABEL` for each mode, which are the same word. */
export const MODE_LABEL: Readonly<Record<Mode, string>> = {
  classic: "CLASSIC",
  maze: "MAZE",
};

/**
 * `OBSTACLE_CELLS`, the course the Maze mode lays across the interior.
 *
 * Four bars, 18 cells. Row 8, the row the snake starts on, carries none of them.
 * The Classic mode's `OBSTACLE_CELLS` is empty, so this list is the whole of the
 * difference between the two boards.
 */
export const MAZE_OBSTACLES: readonly Cell[] = [
  { col: 8, row: 4 },
  { col: 9, row: 4 },
  { col: 10, row: 4 },
  { col: 11, row: 4 },
  { col: 12, row: 4 },
  { col: 13, row: 4 },
  { col: 16, row: 13 },
  { col: 17, row: 13 },
  { col: 18, row: 13 },
  { col: 19, row: 13 },
  { col: 20, row: 13 },
  { col: 21, row: 13 },
  { col: 8, row: 10 },
  { col: 8, row: 11 },
  { col: 8, row: 12 },
  { col: 21, row: 5 },
  { col: 21, row: 6 },
  { col: 21, row: 7 },
];

/** `OBSTACLE_CELLS` for each mode. */
export const OBSTACLE_CELLS: Readonly<Record<Mode, readonly Cell[]>> = {
  classic: [],
  maze: MAZE_OBSTACLES,
};

// ---- Audio cues (specs/ui.md, specs/assets.md) ------------------------------

/** `CUES`: the four cue names, and the only sounds the game plays. */
export const CUES = {
  eat: "eat",
  comboUp: "combo-up",
  death: "death",
  music: "music",
} as const;

/** One of the four cue names. */
export type Cue = (typeof CUES)[keyof typeof CUES];

/** Every cue name, in the order `specs/ui.md` tables them. */
export const CUE_NAMES: readonly Cue[] = [
  CUES.eat,
  CUES.comboUp,
  CUES.death,
  CUES.music,
];

/**
 * Each cue's produced file, at the path `specs/assets.md` fixes for it, written
 * relative to the engine's asset root for the reason {@link SPRITE_PATHS} gives.
 */
export const CUE_PATHS: Readonly<Record<Cue, string>> = {
  eat: "audio/eat.wav",
  "combo-up": "audio/combo-up.wav",
  death: "audio/death.wav",
  music: "audio/music.wav",
};

// ---- Controls (specs/controls.md) -------------------------------------------

/**
 * `LAYOUT`, the touch layout `specs/controls.md` has the game register its
 * actions on.
 *
 * The specification names the layout itself — "the game registers the actions
 * below on the `LAYOUT` (`dpad-4`) touch layout" — so this is a figure the case
 * fixes rather than one the build chooses, and the harness constructs the engine
 * with the layout the specification named rather than with the build's word for
 * it.
 */
export const LAYOUT = "dpad-4";

/**
 * `ACTIONS` and `BINDINGS`: every action, and the keys that fire it.
 *
 * `KeyboardEvent.code` values, because `specs/controls.md` binds a physical key
 * rather than a layout-dependent character.
 */
export const BINDINGS = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
} as const;

/** One of the actions `specs/controls.md` fixes. */
export type Action = keyof typeof BINDINGS;

/** The first key bound to each action: what a check presses when either will do. */
export const KEY: Readonly<Record<Action, string>> = {
  up: BINDINGS.up[0],
  down: BINDINGS.down[0],
  left: BINDINGS.left[0],
  right: BINDINGS.right[0],
  confirm: BINDINGS.confirm[0],
  back: BINDINGS.back[0],
  pause: BINDINGS.pause[0],
  mute: BINDINGS.mute[0],
};

/** The key each direction action's SECOND binding is, which does the same thing. */
export const WASD: Readonly<Record<"up" | "down" | "left" | "right", string>> =
  {
    up: BINDINGS.up[1],
    down: BINDINGS.down[1],
    left: BINDINGS.left[1],
    right: BINDINGS.right[1],
  };
