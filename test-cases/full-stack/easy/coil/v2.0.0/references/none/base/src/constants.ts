// Coil — every figure the specification fixes, in one place.
//
// The stage and the board come from `specs/overview.md` and `specs/board.md`, the
// tick and the turn buffer from `specs/movement.md`, the combo and the points from
// `specs/scoring.md`, the screen copy and the cue names from `specs/ui.md`, the
// sprite sheet from `specs/assets.md`, and the debug version from
// `specs/instrumentation.md`. Nothing here is derived from anything else the build
// decides; the palette and the type live in `src/theme.ts` because they are the
// build's own choices rather than the specification's.
//
// The simulation works entirely in the integer cell coordinates below. Rendering is
// the only thing that maps a cell to its logical square, through `cellX`/`cellY`.

/** One cell of the board, addressed from the top-left. */
export interface Cell {
  col: number;
  row: number;
}

/** The direction the snake travels in. */
export type Dir = "up" | "down" | "left" | "right";

// ---- The stage (specs/overview.md) -------------------------------------------

export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STAGE_CX = 640;
export const STAGE_CY = 360;

// ---- The board (specs/board.md) ----------------------------------------------

/** Columns of the grid, including the one-cell wall border. */
export const GRID_COLS = 30;
/** Rows of the grid, including the one-cell wall border. */
export const GRID_ROWS = 18;
/** The side of one cell, in logical units. */
export const CELL = 32;
/** The logical x of the top-left corner of cell (0, 0). */
export const BOARD_X = 160;
/** The logical y of the top-left corner of cell (0, 0). */
export const BOARD_Y = 120;

/** The interior is everything the one-cell wall border encloses. */
export const INTERIOR_COL_MIN = 1;
export const INTERIOR_COL_MAX = GRID_COLS - 2;
export const INTERIOR_ROW_MIN = 1;
export const INTERIOR_ROW_MAX = GRID_ROWS - 2;

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

// ---- The tick and turning (specs/movement.md) --------------------------------

/** Seconds of simulation time one tick covers, so eight ticks a second. */
export const TICK_SECONDS = 0.125;

/** The most steering requests the buffer holds at once. */
export const TURN_QUEUE_MAX = 2;

// ---- Scoring (specs/scoring.md) ----------------------------------------------

/** The points one pellet is worth before the multiplier is applied. */
export const PELLET_POINTS = 10;

/** The ceiling on the combo multiplier M. */
export const COMBO_MAX = 5;

/** Seconds of simulation time a fully reopened combo window holds. */
export const COMBO_WINDOW = 3.5;

// ---- The debug surface (specs/instrumentation.md) ----------------------------

/** The version the surface reports, and the version the snapshot carries. */
export const COIL_DEBUG_VERSION = 1;

// ---- The produced assets (specs/assets.md) -----------------------------------

/** Frames in the head sheet: the resting pose and the three of the bite. */
export const HEAD_FRAMES = 4;

/** Seconds the bite animation runs for before the head returns to rest. */
export const BITE_SECONDS = 0.25;

// ---- Screen copy (specs/ui.md) -----------------------------------------------

export const TITLE_TEXT = "COIL";
export const TAGLINE_TEXT = "GRID SERPENT";
export const SCORE_LABEL = "SCORE";
export const BEST_LABEL = "BEST";
export const GAMEOVER_TEXT = "GAME OVER";
export const CLEARED_TEXT = "BOARD CLEARED";

/** The title menu's second item; its first is the mode's, in `src/mode.ts`. */
export const HOWTO_ITEM = "HOW TO PLAY";

/** The one item the how-to-play screen's menu holds. */
export const HOWTO_ITEMS: readonly string[] = ["BACK"];

export const PAUSE_ITEMS: readonly string[] = ["RESUME", "RESTART", "MENU"];

export const OVER_ITEMS: readonly string[] = ["PLAY AGAIN", "MENU"];

// ---- Audio cues (specs/ui.md) ------------------------------------------------

/** The four cue names, and the only sounds the game plays. */
export const CUES = {
  eat: "eat",
  comboUp: "combo-up",
  death: "death",
  music: "music",
} as const;

/** One of the four cue names. */
export type Cue = (typeof CUES)[keyof typeof CUES];

// ---- The Maze obstacle course (specs/mode.md) --------------------------------
//
// The four bars the Maze mode lays across the interior. `src/mode.ts` decides
// whether this build lays them; every other module reads `OBSTACLE_CELLS` from
// there rather than this list, so the course lives in one place and the mode is
// the only thing that selects it.

export const MAZE_OBSTACLES: readonly Cell[] = [
  // Bar 1, across the upper left.
  { col: 8, row: 4 },
  { col: 9, row: 4 },
  { col: 10, row: 4 },
  { col: 11, row: 4 },
  { col: 12, row: 4 },
  { col: 13, row: 4 },
  // Bar 2, across the lower right.
  { col: 16, row: 13 },
  { col: 17, row: 13 },
  { col: 18, row: 13 },
  { col: 19, row: 13 },
  { col: 20, row: 13 },
  { col: 21, row: 13 },
  // Bar 3, down the left.
  { col: 8, row: 10 },
  { col: 8, row: 11 },
  { col: 8, row: 12 },
  // Bar 4, down the right.
  { col: 21, row: 5 },
  { col: 21, row: 6 },
  { col: 21, row: 7 },
];

// ---- Cell helpers ------------------------------------------------------------

/** The logical x of the left edge of column `col`. */
export function cellX(col: number): number {
  return BOARD_X + col * CELL;
}

/** The logical y of the top edge of row `row`. */
export function cellY(row: number): number {
  return BOARD_Y + row * CELL;
}

/** Whether `(col, row)` is one of the perimeter cells the wall border occupies. */
export function isWall(col: number, row: number): boolean {
  return (
    col < INTERIOR_COL_MIN ||
    col > INTERIOR_COL_MAX ||
    row < INTERIOR_ROW_MIN ||
    row > INTERIOR_ROW_MAX
  );
}

/** Whether `(col, row)` is an interior cell, which is any cell not a wall cell. */
export function isInterior(col: number, row: number): boolean {
  return !isWall(col, row);
}

/** A single integer naming one cell of the grid, for set membership. */
export function cellKey(col: number, row: number): number {
  return row * GRID_COLS + col;
}
