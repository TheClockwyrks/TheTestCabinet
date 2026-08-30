// Coil — the figures this case's specification fixes. CASE-PROVIDED.
//
// Under an engine the same numbers reach a validator from `src/constants.ts`,
// which is SEEDED into the run: the case hands the build the module and the
// checks import it back. An engineless run seeds no `src/` at all — the build
// writes every module it has, including whichever one it chooses to name these
// figures in — so there is nothing for a check to import, and the values have to
// live on the validator's side of the line.
//
// So this file is that side. Every value below is stated by the seeded
// specification the build was given, under the name that specification uses, and
// nothing here is read from a build: a check that compared a build's own constant
// against itself would grade nothing. The pairing is deliberate —
// `TICK_SECONDS` here is `specs/movement.md`'s tick, and a build that ticks at
// some other rate fails the point rather than moving the target.
//
// Positions are in the logical units of `specs/overview.md` (a fixed
// `STAGE_W x STAGE_H` stage, origin top-left, x right, y down) except where a
// figure is named as a CELL, which is the integer grid coordinate
// `specs/board.md` defines. Every duration is in seconds.

// ---- The stage (specs/overview.md) ------------------------------------------

export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STAGE_CX = 640;
export const STAGE_CY = 360;

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

/** The interior the one-cell border encloses: col [1, 28], row [1, 16]. */
export const INTERIOR_COL_MIN = 1;
export const INTERIOR_COL_MAX = GRID_COLS - 2;
export const INTERIOR_ROW_MIN = 1;
export const INTERIOR_ROW_MAX = GRID_ROWS - 2;

/** Interior cells there are: `28 x 16`, which is the board a snake may fill. */
export const INTERIOR_CELLS =
  (INTERIOR_COL_MAX - INTERIOR_COL_MIN + 1) *
  (INTERIOR_ROW_MAX - INTERIOR_ROW_MIN + 1);

/** One cell of the board, addressed from the top-left. */
export interface Cell {
  col: number;
  row: number;
}

/** The length the snake starts a round at. */
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

/** The direction the snake travels in. */
export type Dir = "up" | "down" | "left" | "right";

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

/** The seed `reset()` uses when its caller names none. */
export const DEFAULT_SEED = 1;

// ---- The produced assets (specs/assets.md) ----------------------------------

/** Frames in the head sheet: the resting pose and the three of the bite. */
export const HEAD_FRAMES = 4;

/** Seconds the bite runs for before the head returns to frame `0`. */
export const BITE_SECONDS = 0.25;

/** Every produced sprite, at the path `specs/assets.md` fixes for it. */
export const SPRITE_FILES: readonly string[] = [
  "assets/snake/head/0.png",
  "assets/snake/head/1.png",
  "assets/snake/head/2.png",
  "assets/snake/head/3.png",
  "assets/snake/body.png",
  "assets/snake/corner.png",
  "assets/snake/tail.png",
];

/** The four head frames alone, frame `0` first. */
export const HEAD_FILES: readonly string[] = SPRITE_FILES.slice(0, HEAD_FRAMES);

/** The three body sprites, which are one image each rather than a sheet. */
export const BODY_FILES: readonly string[] = SPRITE_FILES.slice(HEAD_FRAMES);

// ---- Screens (specs/ui.md) --------------------------------------------------

/** The screen the game is in, as the snapshot reports it. */
export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "gameover"
  | "cleared";

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

/** The title menu's second item. Its first is the mode's, below. */
export const HOWTO_ITEM = "HOW TO PLAY";

export const PAUSE_ITEMS: readonly string[] = ["RESUME", "RESTART", "MENU"];

export const OVER_ITEMS: readonly string[] = ["PLAY AGAIN", "MENU"];

// ---- The mode (specs/mode.md) -----------------------------------------------
//
// `specs/mode.md` renders per variant and names one mode under the constants
// `MODE_ITEM` and `MODE_LABEL`. This project is staged per ENGINE and runs
// against either variant's build, so both modes are named here and a check reads
// the one the snapshot reports. There is no variant to branch on at the file
// level: `snapshot().mode` is what says which build this is.

/** The mode a build ships, as the snapshot reports it. */
export type Mode = "classic" | "maze";

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
 * Each cue's produced file, at the path `specs/assets.md` fixes for it.
 *
 * These are what `audio-init.js` names a play by: the probe takes the basename
 * of the URL a decoded buffer came from, less its extension and less a bundler's
 * content hash, so `assets/audio/combo-up.wav` bundled as
 * `assets/combo-up-DEXxayDe.wav` is still the `combo-up` cue.
 */
export const CUE_FILES: Readonly<Record<Cue, string>> = {
  [CUES.eat]: "assets/audio/eat.wav",
  [CUES.comboUp]: "assets/audio/combo-up.wav",
  [CUES.death]: "assets/audio/death.wav",
  [CUES.music]: "assets/audio/music.wav",
};

// ---- Key bindings (specs/controls.md) ---------------------------------------
//
// `KeyboardEvent.code` values, because a binding is a physical key rather than a
// layout-dependent character — and because that is the vocabulary a check presses
// in. Under an engine the runtime resolves an action from these; here the build
// wrote the keyboard layer itself, so what a check presses is the key and what it
// reads is the game answering.

/** `ACTIONS` and `BINDINGS`: every action, and the keys that fire it. */
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
export const WASD: Readonly<Record<"up" | "down" | "left" | "right", string>> = {
  up: BINDINGS.up[1],
  down: BINDINGS.down[1],
  left: BINDINGS.left[1],
  right: BINDINGS.right[1],
};

/**
 * A key no action is bound to.
 *
 * Used to arm a build's audio: a browser opens an audio context only on a real
 * user gesture (`specs/ui.md` leaves the unlock to the runtime, which an
 * engineless build writes), and a key with no binding is a gesture that changes
 * nothing. `Backquote` is deliberately not it: `specs/instrumentation.md` gives
 * that key to the diagnostics overlay.
 */
export const UNBOUND_KEY = "KeyZ";

// ---- Tolerances the review items state --------------------------------------

/**
 * The RGB distance two sampled colours must exceed to count as clearly apart:
 * 50 of the 441 the RGB cube spans, which is the figure the visibility points
 * are worded in. The specification fixes no palette, so distinguishability is
 * the whole of what a visibility check reads.
 */
export const DISTINCT_MIN = 50;

/** The greatest RGB distance there is, corner to corner of the cube. */
export const DISTINCT_SPAN = Math.hypot(255, 255, 255);
