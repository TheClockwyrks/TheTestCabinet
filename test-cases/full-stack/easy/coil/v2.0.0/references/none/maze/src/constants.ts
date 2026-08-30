// Coil — fixed geometry, timing, palette, and the Maze obstacle course.
//
// Every value here is drawn straight from the specs and is authoritative for the whole
// build: the grid and its placement (specs/playfield.md), the fixed timestep and combo
// window (specs/mechanics.md), the palette (specs/overview.md), and the four fixed Maze
// bars (specs/gameplay.md). The simulation works entirely in integer cell coordinates;
// rendering maps a cell to its logical-pixel square with `cellX` / `cellY`.

// ---- Stage (specs/overview.md) ------------------------------------------------
export const STAGE_W = 1280;
export const STAGE_H = 720;

// ---- Grid (specs/playfield.md) ------------------------------------------------
export const COLS = 30; // full grid width, including the one-cell wall border
export const ROWS = 18; // full grid height, including the one-cell wall border
export const CELL = 32; // logical px per cell (== one snake segment / pellet)
export const ORIGIN_X = 160; // logical-px top-left of cell (0,0)
export const ORIGIN_Y = 120;

// Interior (playable) bounds — the wall border is the perimeter ring.
export const IN_COL0 = 1;
export const IN_COL1 = COLS - 2; // 28
export const IN_ROW0 = 1;
export const IN_ROW1 = ROWS - 2; // 16

// Snake start: length 3, horizontal, near centre, facing right (specs/playfield.md).
export const START_CELLS = [
  { col: 15, row: 8 },
  { col: 14, row: 8 },
  { col: 13, row: 8 },
];

// ---- Timing & scoring (specs/mechanics.md) ------------------------------------
export const TICK_DT = 0.125; // seconds per tick — 8 ticks/sec, constant for the round
export const COMBO_WINDOW = 3.5; // seconds of sim-time the combo stays open
export const COMBO_MAX = 5; // multiplier cap
export const POINTS_PER_PELLET = 10; // score = POINTS_PER_PELLET * M

// ---- localStorage keys (specs/combo.md) ----------------------------------------
export const BEST_KEY = "coil.best";
export const MUTED_KEY = "coil.muted";

// ---- Palette (specs/overview.md) ----------------------------------------------
export const C = {
  stageBg: "#0b0e14",
  boardBg: "#0f1420",
  gridLine: "#161c28",
  wall: "#2a3550",
  head: "#5ef38c",
  body: "#2fd07a",
  pellet: "#ff5c8a",
  combo: "#ffd23f",
  obstacle: "#ffb454",
  text: "#e6edf3",
  textDim: "#8a94a6",
  textFaint: "#4a5567",
} as const;

// Monospace, no downloaded web font (specs/overview.md).
export const FONT = 'ui-monospace, "DejaVu Sans Mono", "SFMono-Regular", "Consolas", "Courier New", monospace';

// ---- Maze obstacles (specs/gameplay.md) --------------------------------------
// The four fixed bars, point-symmetric through the board centre. Fatal like walls and
// excluded from pellet cells. Used only when MODE === "maze".
export const MAZE_OBSTACLES: { col: number; row: number }[] = [
  // Bar 1
  { col: 8, row: 4 },
  { col: 9, row: 4 },
  { col: 10, row: 4 },
  { col: 11, row: 4 },
  { col: 12, row: 4 },
  { col: 13, row: 4 },
  // Bar 2 (mirror of bar 1)
  { col: 16, row: 13 },
  { col: 17, row: 13 },
  { col: 18, row: 13 },
  { col: 19, row: 13 },
  { col: 20, row: 13 },
  { col: 21, row: 13 },
  // Bar 3
  { col: 8, row: 10 },
  { col: 8, row: 11 },
  { col: 8, row: 12 },
  // Bar 4 (mirror of bar 3)
  { col: 21, row: 5 },
  { col: 21, row: 6 },
  { col: 21, row: 7 },
];

export function cellX(col: number): number {
  return ORIGIN_X + col * CELL;
}

export function cellY(row: number): number {
  return ORIGIN_Y + row * CELL;
}

export function isWall(col: number, row: number): boolean {
  return col < IN_COL0 || col > IN_COL1 || row < IN_ROW0 || row > IN_ROW1;
}
