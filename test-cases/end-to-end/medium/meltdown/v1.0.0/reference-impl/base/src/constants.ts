// Meltdown — geometry, palette, and balance constants. All positions and sizes
// are in logical pixels on a fixed 1280x720 stage (specs/overview.md).

// ---- Stage & grid geometry (specs/playfield.md) --------------------------

export const STAGE_W = 1280;
export const STAGE_H = 720;

// The reactor floor is a 950 x 684 play area ringed by an 18-px casing wall,
// its top-left corner just inside the casing at (18, 18). The casing is
// off-grid and impassable; the build panel is the right strip.
export const CASING = 18; // casing-wall band width (px)
export const TILE = 19; // logical px per tile
export const COLS = 50; // c = 0..49
export const ROWS = 36; // r = 0..35

export const FLOOR_X0 = CASING; // floor origin x = 18
export const FLOOR_Y0 = CASING; // floor origin y = 18
export const FLOOR_W = COLS * TILE; // inner floor width = 950
export const FLOOR_H = ROWS * TILE; // inner floor height = 684
export const FLOOR_X1 = FLOOR_X0 + FLOOR_W; // right floor edge = 968
export const FLOOR_Y1 = FLOOR_Y0 + FLOOR_H; // bottom floor edge = 702

export const REACTOR_W = FLOOR_X1 + CASING; // reactor region: x in [0, 986]

export const PANEL_X = REACTOR_W; // build panel: x in [986, 1280]
export const PANEL_W = STAGE_W - PANEL_X; // 294

export const FIXED_STEP = 1 / 60; // fixed-timestep simulation (specs/controls.md)

// Vents and exhausts — openings cut into the casing wall (specs/playfield.md).
// The surge enters at the two vents and leaves at the two exhausts; the tiles
// listed are the floor edge tiles at each opening. The side (left/right)
// openings span four tiles; the top/bottom openings are twice as wide (eight
// tiles), both centred on the floor's middle column.
export const LEFT_VENT_ROWS = [16, 17, 18, 19];
export const TOP_VENT_COLS = [22, 23, 24, 25, 26, 27, 28, 29];
export const RIGHT_EXHAUST_ROWS = [16, 17, 18, 19];
export const BOTTOM_EXHAUST_COLS = [22, 23, 24, 25, 26, 27, 28, 29];

// ---- Palette (specs/overview.md) -----------------------------------------

export const C = {
  steel: "#15181d",
  grid: "#23272e",
  panel: "#1b1f26",
  edge: "#2c323c",

  casing: "#3b434f", // casing wall (solid steel)
  casingRim: "#565f6d", // casing wall — lit inner rim

  cold: "#3a7bd5",
  warm: "#f2a43a",
  hot: "#ff5e2e",
  white: "#fff1d6",
  trip: "#ff3030",

  rime: "#79e0ff",
  forge: "#ff7a1f",
  sink: "#aebfce", // Sink (heat sink) — the heat-drain mover

  ground: "#a4e22a",
  flyer: "#b66bff",
  boss: "#8a2be2",
  hp: "#2ec27e",

  vent: "#5f9bd6", // Vent (entrance)
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

export const REDLINE = 100; // heat at which any emitter TRIPS offline
export const TRIP_TIME = 5.0; // seconds a tripped tower stays offline

// Surface-cooling ("thermal blanket"): an emitter sheds heat only through its
// perimeter tile-edges that face open air (or the casing). A radiator face
// sheds RAD_K per edge-tile; a plain face only BASE_K. Cooling is proportional
// to heat, so `coeff * (H / REDLINE)` per second (specs/heat.md).
export const RAD_K = 3.6; // air cooling per edge-tile through a radiator face
export const BASE_K = 1.1; // air cooling per edge-tile through a plain face

// Conduction between two touching emitter footprints: heat equalises across the
// shared edge at COND_K per shared edge-tile per degree of difference. Movers
// (Forge/Sink) have no heat of their own and do not conduct.
export const COND_K = 3.5;

// The thermostatic Forge warms each adjacent emitter *toward* its setpoint only:
// it adds FORGE_K * max(0, setpoint - H) per adjacent edge-tile per second, so it
// can never push a gun past its setpoint on its own (specs/heat.md). Setpoint and
// the Sink's per-edge cooling both grow with the mover's level (defs.ts).
export const FORGE_K = 0.9;

// Damage plateau: a shot does `baseDamage * heatMultiplier(H, redline)`. Damage
// ramps on an accelerating curve from MIN_HEAT_MULT cold to MAX_HEAT_MULT at the
// tower's redline R, then holds flat at max from R up to the 100 trip — R is the
// max-efficiency mark (it varies per tower; specs/heat.md, specs/towers.md). The
// cold floor is deliberately LOW: a cold gun is nearly useless, so fielding a
// swarm of never-firing cold towers is not a defence — you must run guns hot,
// which means funnelling the surge past them (a maze) and pacing their heat.
export const MIN_HEAT_MULT = 0.35;
export const MAX_HEAT_MULT = 3.5;
export function heatMultiplier(h: number, redline: number): number {
  const x = Math.min(h, redline) / redline;
  return MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * x * x;
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

// Surge HP scales with wave (specs/gameplay.md): a Wave 20 unit has ~12.8x base HP.
export function hpScale(wave: number): number {
  return 1 + 0.62 * (wave - 1);
}
