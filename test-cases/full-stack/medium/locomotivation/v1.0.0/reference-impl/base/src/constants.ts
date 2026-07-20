// Locomotivation — every tunable constant, one source of truth.
//
// All values are the INITIAL, tunable numbers from the specs (specs/overview.md,
// specs/world.md, specs/character.md, specs/cargo.md, specs/trains.md,
// specs/controls.md). The Balance phase adjusts per-level DATA in `levels.ts`; the
// systemic constants here are the starting design. Positions/sizes are logical pixels
// on the fixed 1280x720 stage; speeds are logical px/second.

// ─── Stage & grid (specs/overview.md, specs/world.md) ──────────────────────────────

/** Fixed logical stage — scales uniformly to the window, letterboxed. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** Top status bar: y in [0, STATUS_BAR_H], full width. */
export const STATUS_BAR_H = 80;

/** Yard viewport: x in [0, 1280], y in [STATUS_BAR_H, 720] → 1280 x 640. */
export const VIEW_X = 0;
export const VIEW_Y = STATUS_BAR_H;
export const VIEW_W = STAGE_W; // 1280
export const VIEW_H = STAGE_H - STATUS_BAR_H; // 640

/** Tile grid: 32 columns x 16 rows of 40px tiles over the yard viewport. */
export const TILE = 40;
export const GRID_COLS = 32;
export const GRID_ROWS = 16;

/** Tile (col,row) → center pixel. */
export function tileCenterX(col: number): number {
  return col * TILE + TILE / 2;
}
export function tileCenterY(row: number): number {
  return VIEW_Y + row * TILE + TILE / 2;
}

// ─── Simulation (specs/controls.md) ────────────────────────────────────────────────

/** Fixed simulation step: 60 Hz. The core sim is stepped at this dt, deterministically. */
export const SIM_HZ = 60;
export const DT = 1 / SIM_HZ;
/** Clamp on how much wall-clock time one frame may advance (avoids spiral-of-death). */
export const MAX_FRAME_DT = 0.25;

// ─── Worker movement (specs/character.md) ──────────────────────────────────────────

/** Base (unladen) speed: 160 px/s = 4 tiles/second. */
export const V0 = 160;

/** Maximum carry weight in capacity units. */
export const W_MAX = 120;

/**
 * Carry-weight speed model breakpoints on w = load / W_MAX:
 *   0.00 ≤ w ≤ 0.50 → m = 1.00 (full), sprint available
 *   0.50 < w ≤ 0.80 → m linear 1.00 → 0.70, sprint available
 *   0.80 < w ≤ 1.00 → m linear 0.70 → 0.50, sprint DISABLED
 */
export const WEIGHT_FULL_UNTIL = 0.5;
export const WEIGHT_SLOW_UNTIL = 0.8;
export const WEIGHT_M_AT_FULL = 1.0;
export const WEIGHT_M_AT_SLOW = 0.7; // multiplier at w = 0.80
export const WEIGHT_M_AT_CAP = 0.5; // multiplier at w = 1.00

/** Above this load fraction, sprint is locked out entirely (HUD shows SPRINT LOCKED). */
export const SPRINT_LOCK_FRACTION = WEIGHT_SLOW_UNTIL; // 0.80

// ─── Sprint (specs/character.md) ───────────────────────────────────────────────────

/** Sprint multiplies the already weight-reduced speed. */
export const SPRINT_MULT = 1.6;
/** Seconds of sprint at full charge. */
export const SPRINT_MAX = 1.6;
/** Seconds to refill the sprint bar from empty to full while not sprinting. */
export const SPRINT_RECHARGE = 4.0;

// ─── Worker footprint (specs/character.md) ─────────────────────────────────────────

/** Collision footprint centered on the worker's feet (base of the sprite). */
export const WORKER_FOOT_W = 24;
export const WORKER_FOOT_H = 20;

/** Reach for pick-up / drop / lever interaction: on the tile or an adjacent tile. */
export const INTERACT_REACH = TILE; // ~1 tile

/** Brief beat (seconds) after a death before the worker respawns at the spawn. */
export const RESPAWN_DELAY = 0.9;

// ─── Cargo (specs/cargo.md) ────────────────────────────────────────────────────────

/** Package weight classes (weight in carry-capacity units). */
export const WEIGHT_PARCEL = 30;
export const WEIGHT_CRATE = 55;
export const WEIGHT_LOAD = 80;

/** Dispenser refill delay after its ready package is taken. */
export const DISPENSER_REFILL = 1.5;

// ─── Trains (specs/trains.md) ──────────────────────────────────────────────────────

/** Per-kind speed (px/s) and length (tiles / px). One tile = TILE px. */
export const FREIGHT_SPEED = 90;
export const FREIGHT_LEN_TILES = 12; // 480 px
export const COMMUTER_SPEED = 190;
export const COMMUTER_LEN_TILES = 5; // 200 px
export const BULLET_SPEED = 380;
export const BULLET_LEN_TILES = 3; // 120 px

export const FREIGHT_LEN = FREIGHT_LEN_TILES * TILE; // 480
export const COMMUTER_LEN = COMMUTER_LEN_TILES * TILE; // 200
export const BULLET_LEN = BULLET_LEN_TILES * TILE; // 120

/** Half-height (px) of a train's LETHAL collision band about its lane center. A worker in
 *  the safe gap between two adjacent parallel tracks (40px away) is clear; on the track it
 *  is inside the band. Smaller than a full tile so the gap always reads safe. */
export const TRAIN_HALF_BAND = 18;

/** Telegraph lead: a signal flips to WARNING when a train is this far (in seconds of
 *  travel) from a crossing; DANGER as it is upon the crossing. */
export const TELEGRAPH_LEAD = 1.6;

/** Distance (px) at which a "danger" (upon-crossing) signal state begins, expressed as
 *  a short lead — kept small so danger reads as imminent. */
export const TELEGRAPH_DANGER_LEAD = 0.4;

/** Near-miss window (px): surviving a brush inside this margin of a moving car scores a
 *  living-dangerously bonus (specs/flow.md). */
export const NEAR_MISS_MARGIN = 10;

// ─── Scoring (specs/flow.md) — initial weights, tunable ────────────────────────────

export const SCORE_REQUIRED_DELIVERY = 100; // per required (dispenser + unique) package
export const SCORE_OPTIONAL_DELIVERY = 250; // per optional package (the greed reward)
export const SCORE_TIME_BONUS_PER_SEC = 20; // per second of shift clock remaining
export const SCORE_LIVES_BONUS = 500; // per unused life
export const SCORE_NEAR_MISS = 40; // per survived near-miss brush
export const SCORE_LAST_TRAIN_BONUS = 3000; // one-off for boarding the last train

/** Shift clock is "low" (alert color, pulsing, low-clock alarm) under this threshold. */
export const LOW_CLOCK_THRESHOLD = 15;

// ─── Palette (specs/overview.md) ───────────────────────────────────────────────────

export const PALETTE = {
  letterbox: "#0d0f12",
  panel: "#171b21",
  ground: "#6b6357",
  grass: "#5f7048",
  ballast: "#463d34",
  rail: "#b9bec6",
  sleeper: "#3c2f26",
  bridgeDeck: "#6a4a33",
  gap: "#24384a",
  refuge: "#8a8f98",
  wall: "#3a3f47",
  roof: "#4b525b",
  gridLine: "#ffffff10",
  freightRed: "#e2503b",
  freightBlue: "#3f8ae0",
  freightGreen: "#46b95c",
  freightAmber: "#f2b03d",
  signalClear: "#46c96a",
  signalWarning: "#ffcf4a",
  signalDanger: "#ff5a52",
  workerHiVis: "#ffd23a",
  workerOveralls: "#c8562e",
  trainFreight: "#6b7280",
  trainCommuter: "#c9d0d8",
  trainBullet: "#eef2f7",
  headlight: "#fff2c4",
  gaugeClock: "#e8eef5",
  gaugeSprint: "#5ad0e6",
  gaugeLoad: "#c48a52",
  score: "#ffd23a",
  textPrimary: "#f0f2f5",
  textSecondary: "#a7b0ba",
  textTertiary: "#6b7580",
} as const;

/** Per-freight-color fill, keyed by the color id used across cargo/dispensers/zones. */
export const FREIGHT_COLOR: Record<"red" | "blue" | "green" | "amber", string> = {
  red: PALETTE.freightRed,
  blue: PALETTE.freightBlue,
  green: PALETTE.freightGreen,
  amber: PALETTE.freightAmber,
};

/** Monospace system stack — no downloaded web font (specs/overview.md). */
export const FONT_STACK =
  '"SFMono-Regular", "JetBrains Mono", "Fira Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
