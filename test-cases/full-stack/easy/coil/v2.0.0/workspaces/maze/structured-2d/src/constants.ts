// Coil — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Two coordinate spaces meet in this file and they are not the same. The
// SIMULATION runs in whole cells: integer `(col, row)` pairs over the grid
// `specs/board.md` lays out, and a position between two cells never occurs. The
// STAGE is the fixed 1280x720 logical space `specs/overview.md` defines (origin
// top-left, x right, y down), which is the engine's logical design size: the
// engine scales and letterboxes it onto the canvas, so no value here is ever
// expressed in real pixels. Rendering maps a cell onto its logical square with
// `BOARD_X`, `BOARD_Y`, and `CELL`; the simulation never leaves cell space.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Coil fixes no palette, no font,
// no sprite artwork, no glow, and no background. There is not a single color or
// type face in this file, and there is not meant to be one. `specs/overview.md`
// and `specs/ui.md` state what a player has to be able to read at a glance; how
// the board looks is the build's to design.
//
// Every duration here is in SECONDS, because the engine hands the game the real
// elapsed seconds of each frame and imposes no timestep of its own. `specs/movement.md`
// states how those seconds are consumed into whole ticks.

// ---- Stage (specs/overview.md) -------------------------------------------

/** The logical design size. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The stage center. */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

// ---- Board geometry (specs/board.md) -------------------------------------

/** The cell grid, wall border included. */
export const GRID_COLS = 30;
export const GRID_ROWS = 18;

/** The side of one square cell, in logical units. */
export const CELL = 32;

/**
 * The logical position of the board's top-left corner, so cell `(col, row)` has
 * its top-left corner at `(BOARD_X + col * CELL, BOARD_Y + row * CELL)` and its
 * center half a cell further on each axis.
 *
 * The board therefore spans x 160..1120 and y 120..696, which is 960x576, and
 * leaves the band above it, y in [0, BOARD_Y), for the HUD.
 */
export const BOARD_X = 160;
export const BOARD_Y = 120;

/** One cell of the grid, addressed the way the whole simulation addresses one. */
export interface Cell {
  readonly col: number;
  readonly row: number;
}

/**
 * The interior, inclusive on both ends: every cell that is not part of the
 * one-cell wall border. The border is row 0, row `GRID_ROWS - 1`, column 0, and
 * column `GRID_COLS - 1`, so the interior is 28x16 cells.
 */
export const INTERIOR_MIN_COL = 1;
export const INTERIOR_MAX_COL = GRID_COLS - 2;
export const INTERIOR_MIN_ROW = 1;
export const INTERIOR_MAX_ROW = GRID_ROWS - 2;

// ---- The snake's start (specs/board.md) ----------------------------------

/** The length, in cells, of the chain a round starts with. */
export const START_LENGTH = 3;

/**
 * The starting chain, head first, laid horizontally near the center of the
 * board. Its length is `START_LENGTH`.
 */
export const START_CELLS: readonly Cell[] = [
  { col: 15, row: 8 },
  { col: 14, row: 8 },
  { col: 13, row: 8 },
];

/** The direction the starting chain faces. */
export const START_DIR = "right";

// ---- The tick and turning (specs/movement.md) ----------------------------

/**
 * One tick of the simulation, in seconds: eight ticks per second. The snake
 * advances exactly one cell per tick, at this rate, for the whole round however
 * long it has grown.
 */
export const TICK_SECONDS = 0.125;

/** The four directions the snake travels in. */
export const DIRECTIONS = ["up", "down", "left", "right"] as const;

export type Direction = (typeof DIRECTIONS)[number];

/**
 * How many steering requests the turn buffer holds. A request arriving at a full
 * buffer is discarded.
 */
export const TURN_QUEUE_MAX = 2;

// ---- Scoring and the combo (specs/scoring.md) ----------------------------

/** The base value of one eaten pellet, before the multiplier. */
export const PELLET_POINTS = 10;

/** The highest the combo multiplier reaches. It starts each round at 1. */
export const COMBO_MAX = 5;

/**
 * The full combo window, in seconds of simulation time. Step 6 of each tick
 * draws `TICK_SECONDS` off it, so a full window is a budget of 28 ticks.
 */
export const COMBO_WINDOW = 3.5;

// ---- The mode (specs/mode.md) --------------------------------------------

/** The one mode this build ships, as the debug snapshot reports it. */
export const MODE = "maze";

/** The mode's entry in the title menu, and its short label in the HUD. */
export const MODE_ITEM = "MAZE";
export const MODE_LABEL = "MAZE";

/**
 * The interior cells this mode lays as obstacles: the fixed course of four bars,
 * eighteen cells in all. They are the same cells in every round and never change
 * while a round runs.
 *
 * Each is solid and fatal to the head exactly as a wall cell is, and none of them
 * is ever a valid pellet cell. Row 8, the row the starting chain lies on, carries
 * none of them.
 */
export const OBSTACLE_CELLS: readonly Cell[] = [
  // Bar 1 — a horizontal run across the upper board.
  { col: 8, row: 4 },
  { col: 9, row: 4 },
  { col: 10, row: 4 },
  { col: 11, row: 4 },
  { col: 12, row: 4 },
  { col: 13, row: 4 },
  // Bar 2 — a horizontal run across the lower board.
  { col: 16, row: 13 },
  { col: 17, row: 13 },
  { col: 18, row: 13 },
  { col: 19, row: 13 },
  { col: 20, row: 13 },
  { col: 21, row: 13 },
  // Bar 3 — a vertical run on the left.
  { col: 8, row: 10 },
  { col: 8, row: 11 },
  { col: 8, row: 12 },
  // Bar 4 — a vertical run on the right.
  { col: 21, row: 5 },
  { col: 21, row: 6 },
  { col: 21, row: 7 },
];

// ---- Screens and screen copy (specs/ui.md) -------------------------------

/** Every screen the game moves between. It opens on `title`. */
export const SCREENS = [
  "title",
  "howto",
  "playing",
  "paused",
  "gameover",
  "cleared",
] as const;

export type Screen = (typeof SCREENS)[number];

/** The title screen's heading and tagline. */
export const TITLE_TEXT = "COIL";
export const TAGLINE_TEXT = "GRID SERPENT";

/** The two readout labels, used on the title, the HUD, and the end screens. */
export const SCORE_LABEL = "SCORE";
export const BEST_LABEL = "BEST";

/** The heading each of the two endings shows. */
export const GAMEOVER_TEXT = "GAME OVER";
export const CLEARED_TEXT = "BOARD CLEARED";

/** The title menu: the mode's entry first, then how to play. */
export const TITLE_ITEMS: readonly string[] = [MODE_ITEM, "HOW TO PLAY"];

/** The pause menu. */
export const PAUSE_ITEMS: readonly string[] = ["RESUME", "RESTART", "MENU"];

/** The menu both end screens carry. */
export const OVER_ITEMS: readonly string[] = ["PLAY AGAIN", "MENU"];

// ---- Controls (specs/controls.md) ----------------------------------------

/**
 * The touch layout Coil declares, which fixes the action vocabulary the build
 * speaks: a four-way pad, plus the menu actions every layout carries.
 * `src/main.ts` hands it to the engine.
 */
export const LAYOUT = "dpad-4";

/** Every action Coil registers: the four-way pad and the menu vocabulary. */
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
 * is a physical key rather than a layout-dependent character. The two sets bound
 * to the four directions are interchangeable everywhere they are read.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The four cue names, one per event. Define and play exactly these. */
export const CUES = {
  eat: "eat",
  comboUp: "combo-up",
  death: "death",
  music: "music",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- The produced assets (specs/assets.md) -------------------------------

/**
 * Every produced file this build loads, as a path under the engine's asset root
 * (`assets/`). The files themselves do not exist yet: this build produces them
 * with the generation binaries on the `PATH` and commits them here.
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

export const CUE_PATHS: Readonly<Record<CueName, string>> = {
  eat: "audio/eat.wav",
  "combo-up": "audio/combo-up.wav",
  death: "audio/death.wav",
  music: "audio/music.wav",
};

/** The frames of the head sheet, of which frame 0 is the resting pose. */
export const HEAD_FRAMES = 4;

/** How long the bite plays frames 1, 2, and 3 before the head rests again. */
export const BITE_SECONDS = 0.25;

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const COIL_DEBUG_VERSION = 1;
