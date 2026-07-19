// Wireworm — fixed constants. All positions/sizes/speeds are in the logical
// 1280x720 stage-pixel space defined in specs/overview.md; rendering scales this
// uniformly to the window. Numeric balance follows specs/worm.md, specs/foes.md,
// and specs/flow.md — a starting balance, kept in one place so it is easy to tune.

// ---- Stage & board geometry (specs/overview.md, specs/playfield.md) --------
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const HUD_H = 80;
export const BOARD_X = 0;
export const BOARD_Y = 80;
export const BOARD_W = 1280;
export const BOARD_H = 640;

export const TILE = 32;
export const COLS = 40; // 0..39
export const ROWS = 20; // 0..19

// The player band is the bottom 2 rows (rows 18..19), y in [656, 720].
export const BAND_TOP_ROW = 18;
export const BAND_TOP_Y = BOARD_Y + BAND_TOP_ROW * TILE; // 656

// The starting node scatter lives in rows 1..17 (never the entry row 0, never the
// player band), at 10%-15% of those tiles (specs/playfield.md).
export const SCATTER_TOP_ROW = 1;
export const SCATTER_BOTTOM_ROW = 17;
export const SCATTER_MIN_FRACTION = 0.1;
export const SCATTER_MAX_FRACTION = 0.15;

// ---- Simulation --------------------------------------------------------------
export const FIXED_STEP = 1 / 120;

// ---- Worm (specs/worm.md) ----------------------------------------------------
export const WORM_STEP_L1 = 0.14; // tile-step interval at level 1
export const WORM_STEP_FLOOR = 0.07; // fastest cadence
export const WORM_STEP_DECAY = 0.95; // ~5% shorter interval per level
export function wormStepInterval(level: number): number {
  return Math.max(WORM_STEP_FLOOR, WORM_STEP_L1 * Math.pow(WORM_STEP_DECAY, level - 1));
}
export function wormLength(level: number): number {
  return 10 + 2 * (level - 1);
}

// ---- Charge (specs/charge.md) ------------------------------------------------
export const CHARGE_MAX = 3;
export const DISCHARGE_RADIUS = 2; // Chebyshev radius of the chain-arc

// ---- Cursor & firing (specs/controls.md) -------------------------------------
export const CURSOR_SPEED = 430; // px/s in the band
export const FIRE_COOLDOWN = 0.15; // min seconds between bolts
export const MAX_BOLTS = 3; // bolts in flight at once
export const BOLT_SPEED = 900; // px/s upward
export const RESPAWN_INVULN = 2.0; // spawn-in invulnerability, seconds

// ---- Lives & scoring (specs/flow.md) -----------------------------------------
export const START_LIVES = 3;
export const TOTAL_LEVELS = 12;
export const BONUS_LIFE_EVERY = 12000;

export const SCORE_BODY = 10;
export const SCORE_HEAD = 100;
export const SCORE_DISCHARGE_FRY = 10; // a worm segment fried by a discharge
export const SCORE_DISCHARGE_NODE = 5; // each node cleared by a discharge
export const SCORE_INERT_NODE = 1; // an inert node shot down
export const SCORE_GLITCH = 300;
export const SCORE_DROPPER = 200;
export const SCORE_CORRUPTOR = 1000;
export const SCORE_LEVEL_CLEAR = 100; // * level
export const SCORE_VICTORY = 250; // * livesRemaining

// ---- Foe spawn gates & pacing (specs/foes.md) --------------------------------
export const GLITCH_FROM_LEVEL = 2;
export const GLITCH_MAX_ON_BOARD = 2;
export const GLITCH_MIN_INTERVAL = 7.0;
export const GLITCH_MAX_INTERVAL = 12.0;

export const DROPPER_FROM_LEVEL = 3;
export const DROPPER_SPARSE_THRESHOLD = 8; // nodes in the lower half below this
export const DROPPER_RECHECK = 2.5; // seconds between sparse-field checks

export const CORRUPTOR_FROM_LEVEL = 5;
export const CORRUPTOR_MIN_INTERVAL = 14.0;
export const CORRUPTOR_MAX_INTERVAL = 22.0;

// ---- Foe kinematics ----------------------------------------------------------
export const GLITCH_H_SPEED = 210;
export const GLITCH_V_SPEED = 62;
export const GLITCH_TURN_INTERVAL = 0.32; // re-pick horizontal dart direction
export const DROPPER_SPEED = 150;
export const DROPPER_SPEED_HIT = 320; // after the first bolt
export const CORRUPTOR_SPEED = 130;

// ---- Palette (specs/overview.md) --------------------------------------------
export const COLORS = {
  board: "#0b1418",
  grid: "#14282e",
  band: "#0f1f1c",
  hud: "#0c191c",
  edge: "#1c3a40",
  arc: "#b8ffe6",
  spark: "#ffb43a",
  cursorCore: "#57e0ff",
  cursorHi: "#eafcff",
  score: "#54e6bd",
  text: "#dfeef0",
  textDim: "#7f9aa0",
  textFaint: "#4a6068",
  wormEdge: "#c06bff",
  c1: "#2f9e86",
  c2: "#54e6bd",
  c3: "#e6fff7",
  glitch: "#d92b4a",
  dropper: "#e8a83a",
  corruptor: "#8fd63a",
  eye: "#ff5a3c",
} as const;

export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- Tile <-> pixel helpers --------------------------------------------------
export const tileLeft = (c: number): number => BOARD_X + c * TILE;
export const tileTop = (r: number): number => BOARD_Y + r * TILE;
export const tileCX = (c: number): number => BOARD_X + c * TILE + TILE / 2;
export const tileCY = (r: number): number => BOARD_Y + r * TILE + TILE / 2;
export const inBounds = (c: number, r: number): boolean =>
  c >= 0 && c < COLS && r >= 0 && r < ROWS;
