// Meltdown — geometry, palette, and balance constants. All positions and sizes
// are in logical pixels on a fixed 1280x720 stage (specs/overview.md).

// ---- Stage & grid geometry (specs/playfield.md) --------------------------

export const STAGE_W = 1280;
export const STAGE_H = 720;

export const FLOOR_W = 1000; // reactor floor: x in [0, 1000]
export const FLOOR_H = 720;

export const PANEL_X = 1000; // build panel: x in [1000, 1280]
export const PANEL_W = 280;

export const TILE = 20; // logical px per tile
export const COLS = 50; // c = 0..49
export const ROWS = 36; // r = 0..35

export const FIXED_STEP = 1 / 60; // fixed-timestep simulation (specs/controls.md)

// Portals — four-tile edge openings (specs/playfield.md).
export const LEFT_INTAKE_ROWS = [16, 17, 18, 19];
export const TOP_INTAKE_COLS = [24, 25, 26, 27];
export const RIGHT_EXHAUST_ROWS = [16, 17, 18, 19];
export const BOTTOM_EXHAUST_COLS = [24, 25, 26, 27];

// ---- Palette (specs/overview.md) -----------------------------------------

export const C = {
  steel: "#15181d",
  grid: "#23272e",
  panel: "#1b1f26",
  edge: "#2c323c",

  cold: "#3a7bd5",
  warm: "#f2a43a",
  hot: "#ff5e2e",
  white: "#fff1d6",
  trip: "#ff3030",

  rime: "#79e0ff",
  forge: "#ff7a1f",
  vent: "#aebfce",

  ground: "#a4e22a",
  flyer: "#b66bff",
  boss: "#8a2be2",
  hp: "#2ec27e",

  intake: "#5f9bd6",
  exhaust: "#ff5a3c",
  money: "#ffcf4d",
  hazard: "#ffd400",
  ok: "#46d07a",
  bad: "#ff4d4d",

  text: "#e8edf3",
  textDim: "#97a3b0",
  textFaint: "#5b6675",
} as const;

export const MONO =
  '"DejaVu Sans Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---- Heat model (specs/heat.md) ------------------------------------------

export const REDLINE = 100;
export const TRIP_TIME = 3.0; // seconds a tripped tower stays offline

// damage = baseDamage * heatMultiplier(H): 0.5x cold, ~3.0x near the redline.
export function heatMultiplier(h: number): number {
  const x = h / 100;
  return 0.5 + 2.5 * x * x;
}

// ---- Economy & flow (specs/flow.md) --------------------------------------

export const START_MONEY = 250;
export const START_LIVES = 20;
export const TOTAL_WAVES = 20;
export const BUILD_PHASE_TIME = 15; // seconds
export const INTEREST_RATE = 0.08;
export const INTEREST_CAP = 40;
export const MILESTONE_WAVES = [10, 20];

export function waveClearBonus(wave: number): number {
  return 20 + 5 * wave;
}

// Surge HP scales with wave (specs/flow.md).
export function hpScale(wave: number): number {
  return 1 + 0.15 * (wave - 1);
}
