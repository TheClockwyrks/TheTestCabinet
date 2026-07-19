// Spectra — canonical constants.
//
// Every value is in the fixed 1280x720 logical-pixel coordinate space defined by
// the specification (origin top-left, x right, y down). Rendering scales this
// space uniformly to the window; gameplay never leaves it. See specs/overview.md
// (coordinate system, palette), specs/playfield.md (geometry), specs/polarity.md,
// specs/controls.md, specs/enemies.md, and specs/flow.md.

export const FIELD_W = 1280;
export const FIELD_H = 720;

// The three horizontal bands of the stage.
export const HUD_TOP_H = 64; // top HUD strip: y in [0, 64]
export const PLAY_TOP = 64; // play field: y in [64, 656]
export const PLAY_BOTTOM = 656;
export const HUD_BOTTOM_TOP = 656; // bottom HUD strip: y in [656, 720]

// ---- Palette (matches specs/overview.md and reference/theme.css) -----------
export const COLOR = {
  void: "#05060f",
  star: "#283250",
  raised: "#0b1020",
  cyan: "#34e2ff",
  magenta: "#ff4ec7",
  ship: "#eaf0fb",
  resonance: "#ffd86b",
  discharge: "#ffffff",
  text: "#e8eef7",
  textDim: "#8893ad",
  textFaint: "#4a5470",
  panelBorder: "#1a2440",
} as const;

// A system monospace stack: no downloaded web font, so the game renders
// identically offline.
export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- Bands ----------------------------------------------------------------
export const CYAN = 0;
export const MAGENTA = 1;
export type Band = typeof CYAN | typeof MAGENTA;
export function opposite(b: Band): Band {
  return (b === CYAN ? MAGENTA : CYAN) as Band;
}
export function bandColor(b: Band): string {
  return b === CYAN ? COLOR.cyan : COLOR.magenta;
}
export function bandName(b: Band): string {
  return b === CYAN ? "CYAN" : "MAGENTA";
}
// Lowercase band strings, the form the debug API reports and accepts
// (specs/instrumentation.md).
export type BandStr = "cyan" | "magenta";
export function bandStr(b: Band): BandStr {
  return b === CYAN ? "cyan" : "magenta";
}
export function parseBand(s: string): Band {
  return s === "magenta" ? MAGENTA : CYAN;
}

// ---- Player ship ----------------------------------------------------------
export const SHIP_Y = 600; // fixed lane center y
export const SHIP_W = 40;
export const SHIP_H = 28;
export const SHIP_MIN_X = 40;
export const SHIP_MAX_X = 1240;
export const SHIP_SPEED = 360; // px/s while a direction is held
export const SHIP_HIT_R = 15; // collision radius for bullets/bodies

// ---- Firing ---------------------------------------------------------------
export const PBULLET_SPEED = 760; // up
export const PBULLET_W = 4;
export const PBULLET_H = 16;
export const FIRE_CADENCE = 0.16; // seconds between shots
export const PBULLET_CAP = 3; // max player bullets on field
export const FLIP_LOCKOUT = 0.3; // fire lockout after a flip

// ---- Enemy bullets --------------------------------------------------------
export const EBULLET_SPEED = 320; // down, stage-1 base
export const EBULLET_W = 6;
export const EBULLET_H = 12;
export const EBULLET_HIT_R = 8;

// ---- Formation ------------------------------------------------------------
export const SLOT_DX = 64; // horizontal slot spacing
export const SLOT_DY = 48; // vertical slot spacing
export const FORM_COLS = 9;
export const FORM_ROWS = 5;
export const FORM_CENTER_X = 640;
export const FORM_ROW0_Y = 140; // row r center y = 140 + 48*r
export const SWAY_AMP = 20; // px
export const SWAY_PERIOD = 5; // seconds

// ---- Drone footprints -----------------------------------------------------
export const SHARD_SIZE = 28;
export const FLUX_SIZE = 30;
export const PRISM_SIZE = 56;
export const PRISM_CORE_SIZE = 26;

// ---- Drone movement (stage-1 base speeds) ---------------------------------
export const ENTER_SPEED = 260; // px/s along entrance path
export const DIVE_SPEED = 300; // px/s along dive path
export const ENTER_GROUP_GAP = 0.6; // seconds between entering groups
export const DIVE_FIRST_DELAY = 2.0; // after formation assembles
export const DIVE_GAP_MIN = 1.4;
export const DIVE_GAP_MAX = 2.6;

// ---- Flux rhythm ----------------------------------------------------------
export const FLUX_HOLD = 1.6; // stage-1 hold, per band
export const FLUX_SHIMMER = 0.4; // telegraph, settled on neither band

// ---- Prism ----------------------------------------------------------------
export const PRISM_INVERT_Y = 640; // a diving Prism crossing this triggers inversion
export const INVERSION_TIME = 5.0; // seconds bands stay swapped

// ---- Resonance / discharge ------------------------------------------------
export const RES_MAX = 100;
export const RES_ABSORB = 6; // per absorbed same-band bullet
export const RES_KILL = 4; // per matching kill (Prism core counts, shell does not)
export const DISCHARGE_TIME = 0.5; // expanding-wave duration
export const DISCHARGE_MAX_R = 1500; // wave radius that covers the whole stage

// ---- Lives / scoring ------------------------------------------------------
export const START_LIVES = 3;
export const EXTRA_LIFE_AT = 20000;
export const READY_HOLD = 1.3; // seconds after losing a life

export const SCORE = {
  shardForm: 50,
  shardDive: 100,
  fluxForm: 80,
  fluxDive: 160,
  prismShell: 100,
  prismCore: 400,
  challenge: 100,
  perfectBonus: 10000,
  stageClear: 1000,
} as const;

// ---- Challenge stages -----------------------------------------------------
export const CHALLENGE_GROUPS = 5;
export const CHALLENGE_PER_GROUP = 8;
export const CHALLENGE_TOTAL = CHALLENGE_GROUPS * CHALLENGE_PER_GROUP;

// ---- Timing ---------------------------------------------------------------
export const FIXED_STEP = 1 / 120; // physics timestep (Hz)
export const STAGE_INTRO_TIME = 2.0; // hold before a wave
export const STAGE_CLEARED_TIME = 2.6; // interstitial

// ---- Stage scaling (specs/flow.md) ----------------------------------------
export function droneSpeedMult(stage: number): number {
  return Math.min(1.5, 1 + 0.06 * (stage - 1));
}
export function enemyBulletMult(stage: number): number {
  return Math.min(1.4, 1 + 0.04 * (stage - 1));
}
export function diveGapMult(stage: number): number {
  return Math.max(0.55, 1 - 0.05 * (stage - 1));
}
export function fluxHoldFor(stage: number): number {
  return Math.max(1.0, FLUX_HOLD - 0.05 * (stage - 1));
}

// A challenge stage occurs every third stage.
export function isChallengeStage(stage: number): boolean {
  return stage % 3 === 0;
}

// ---- Slot geometry --------------------------------------------------------
// Slot centers (before sway) for column c (0..8) and row r (0..4).
export function slotX(col: number): number {
  return FORM_CENTER_X + SLOT_DX * (col - (FORM_COLS - 1) / 2);
}
export function slotY(row: number): number {
  return FORM_ROW0_Y + SLOT_DY * row;
}
export function swayOffset(t: number): number {
  return SWAY_AMP * Math.sin((2 * Math.PI * t) / SWAY_PERIOD);
}
