// Floe — canonical constants.
//
// Every value here is in the fixed 1280x720 logical-pixel space defined by the
// specification (origin top-left, x right, y down). Rendering scales this space
// uniformly to the window; gameplay never leaves it. See specs/overview.md and
// specs/playfield.md.

// ---- Stage & strait geometry -------------------------------------------
export const STAGE_W = 1280;
export const STAGE_H = 720;

export const HUD_H = 80; // HUD bar: y in [0, 80]
export const STRAIT_TOP = 80; // strait: y in [80, 720]
export const STRAIT_W = 1280;
export const STRAIT_H = 640;

export const TILE = 32;
export const COLS = 40; // 40 columns
export const ROWS = 20; // 20 rows (strait-local); row 0 = top, row 19 = bottom

// ---- Band rows (strait-local row indices) ------------------------------
export const ROW_CAP = 0; // far-shore solid cap
export const ROW_BAYS = 1; // far-shore row cut by the goal bays
export const WATER_TOP = 2; // water band rows 2..9
export const WATER_BOTTOM = 9;
export const ROW_MEDIAN = 10; // median shelf
export const ICE_TOP = 11; // ice band rows 11..18
export const ICE_BOTTOM = 18;
export const ROW_NEAR = 19; // near shore (spawn / bear emerge)

// ---- Goal bays (row 1) — 5 bays, each 2 tiles wide ----------------------
// Column pairs, matching the reference mockup (left x 96/352/608/864/1120).
export const BAYS: ReadonlyArray<readonly [number, number]> = [
  [3, 4],
  [11, 12],
  [19, 20],
  [27, 28],
  [35, 36],
];
export const BAY_COUNT = BAYS.length;

// ---- Palette (matches specs/overview.md and reference/theme.css) --------
export const COLOR = {
  sea: "#0a2233",
  seaDeep: "#061a28",
  grid: "#123a4e",
  ice: "#dfeef5",
  iceBlue: "#c3dee9",
  iceEdge: "#8fb6c9",
  median: "#cfe6f2",
  road: "#9fb9c7",
  roadGrid: "#7a97a6",
  bay: "#ffd27f",

  critter: "#f2a03a",
  cream: "#ffe0a8",

  score: "#7fe0d0",
  danger: "#e0492f",
  splash: "#cfe6f2",

  hudBg: "#0c191c",
  hudBorder: "#1c3a40",
  cardBg: "#0c191c",
  cardBorder: "#1c3a40",

  text: "#eaf4f8",
  textDim: "#8fb6c9",
  textFaint: "#4d7488",
} as const;

// A system monospace stack: no downloaded web font, so the game renders
// identically offline.
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- Timing ------------------------------------------------------------
export const FIXED_STEP = 1 / 120; // physics timestep (seconds)
export const HOP_COOLDOWN = 0.12; // min seconds between critter hops
export const HOP_ANIM = 0.12; // seconds the crouch->leap frame plays

// ---- Lives, timer, levels ----------------------------------------------
export const START_LIVES = 3;
export const TOTAL_LEVELS = 8;
export const LEVEL_SPEED_STEP = 1.06; // +6% lane/bear speed per level
export const BEAR_SPEED_STEP = 1.06; // bear speed grows ~6% per level
export const SECOND_BEAR_LEVEL = 5;

export const TIMER_BASE = 30; // seconds at level 1
export const TIMER_PER_LEVEL = 2; // seconds shorter per level (floored below)
export const TIMER_MIN = 15;

// ---- Death / respawn pacing --------------------------------------------
export const DEATH_PAUSE = 0.9; // splash / pause after a death
export const CLEAR_PAUSE = 1.6; // pause after clearing a level
export const BAYFILL_PAUSE = 0.5; // brief pause after filling a bay

// ---- The bear ----------------------------------------------------------
// Continuous, pacman-style motion: a fixed glide speed (tiles/second), turning
// only at tile centers. ~3 tiles/s on ice/floe and ~2 tiles/s swimming (level 1).
export const BEAR_ICE_SPEED = 3.0; // tiles/second on ice or a floe (level 1)
export const BEAR_SWIM_SPEED = 2.0; // tiles/second over open water (level 1)
export const BEAR_EMERGE_ADVANCE = 3; // rows the critter must advance first
export const BEAR_EMERGE_DELAY = 0.6; // min seconds before (re)emerging
export const BEAR_SECOND_DELAY = 1.4; // extra stagger for the second bear
export const BEAR_CATCH_DIST = 18; // px between centers that counts as a catch

// ---- Scoring -----------------------------------------------------------
export const SCORE_ROW = 10; // per net new row advanced
export const SCORE_BAY = 50; // per bay reached
export const SCORE_TIME_BONUS = 2; // per whole second left on the timer
export const SCORE_LEVEL = 100; // times level, on clearing a level
export const SCORE_VICTORY_LIFE = 250; // per remaining life at victory
