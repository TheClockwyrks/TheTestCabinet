// Meltdown — every figure the specification fixes, named once.
//
// This build stands on no engine, so nothing is seeded: each value below comes
// from the spec file named beside it, and the value stated there is
// authoritative. Nothing about the LOOK is here — no colour, no font, no panel
// metric — because the specification leaves the look to the build
// (specs/overview.md). Those live in `src/theme.ts` and `src/panel.ts`.

import type {
  DifficultyId,
  Exhaust,
  ModeId,
  SurgeType,
  TowerType,
  Vent,
} from "./types";

// ---- Stage, panel and floor (specs/overview.md, specs/floor.md) ----------

/** The fixed logical stage the whole game is drawn and measured in. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The casing band that rings the floor, in logical units. */
export const CASING = 18;
/** One tile's side, in logical units. */
export const TILE = 19;
/** The floor's grid, in tiles. */
export const COLS = 50;
export const ROWS = 36;

/** The floor rectangle, just inside the casing. */
export const FLOOR_X0 = CASING;
export const FLOOR_Y0 = CASING;
export const FLOOR_W = COLS * TILE;
export const FLOOR_H = ROWS * TILE;
export const FLOOR_X1 = FLOOR_X0 + FLOOR_W;
export const FLOOR_Y1 = FLOOR_Y0 + FLOOR_H;

/** The reactor region, and the build panel's strip beside it. */
export const REACTOR_W = FLOOR_X1 + CASING;
export const PANEL_X = REACTOR_W;
export const PANEL_W = STAGE_W - PANEL_X;

/** Tile `(c, r)`'s top-left corner on the stage. */
export function tileLeft(c: number): number {
  return FLOOR_X0 + TILE * c;
}
export function tileTop(r: number): number {
  return FLOOR_Y0 + TILE * r;
}

/** Tile `(c, r)`'s centre on the stage. */
export function tileCX(c: number): number {
  return FLOOR_X0 + TILE * c + TILE / 2;
}
export function tileCY(r: number): number {
  return FLOOR_Y0 + TILE * r + TILE / 2;
}

/** Whether a tile address lies on the grid. */
export function inBounds(c: number, r: number): boolean {
  return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

/** The tile a stage position falls in; may be off the grid. */
export function tileOfX(x: number): number {
  return Math.floor((x - FLOOR_X0) / TILE);
}
export function tileOfY(y: number): number {
  return Math.floor((y - FLOOR_Y0) / TILE);
}

/** A footprint's centre: the point range is measured from. */
export function footprintCentre(
  col: number,
  row: number,
  size: number,
): { x: number; y: number } {
  return {
    x: tileLeft(col) + (size * TILE) / 2,
    y: tileTop(row) + (size * TILE) / 2,
  };
}

// ---- The openings (specs/floor.md) ---------------------------------------

export const LEFT_VENT_ROWS: readonly number[] = [16, 17, 18, 19];
export const RIGHT_EXHAUST_ROWS: readonly number[] = [16, 17, 18, 19];
export const TOP_VENT_COLS: readonly number[] = [
  22, 23, 24, 25, 26, 27, 28, 29,
];
export const BOTTOM_EXHAUST_COLS: readonly number[] = [
  22, 23, 24, 25, 26, 27, 28, 29,
];

/** Each vent's fixed opposite exhaust, assigned for a unit's whole life. */
export const OPPOSITE: Record<Vent, Exhaust> = {
  left: "right",
  top: "bottom",
};

// ---- Heat (specs/heat.md) ------------------------------------------------

/** The top of the heat scale, and the heat an emitter trips at. */
export const TRIP_HEAT = 100;
/** Seconds a tripped emitter stays offline. */
export const TRIP_TIME = 5.0;

/** Air cooling per radiator edge-tile per second, at heat 100. */
export const RAD_K = 3.6;
/** Air cooling per plain edge-tile per second, at heat 100. */
export const BASE_K = 1.1;
/** Conduction across one shared edge-tile, per degree, per second. */
export const COND_K = 3.5;
/** The Forge's flow per shared edge-tile, per degree below setpoint, per second. */
export const FORGE_K = 0.9;

/** The damage multiplier cold, and at the redline and above it. */
export const MIN_HEAT_MULT = 0.35;
export const MAX_HEAT_MULT = 3.5;

/**
 * The damage multiplier at heat `h` for an emitter whose redline is `redline`:
 * a quadratic climb to the redline, then a flat plateau up to the trip.
 */
export function heatMultiplier(h: number, redline: number): number {
  const x = Math.min(h, redline) / redline;
  return MIN_HEAT_MULT + (MAX_HEAT_MULT - MIN_HEAT_MULT) * x * x;
}

// ---- Towers (specs/towers.md) --------------------------------------------

/** The shop order, which is also the order `arm1`..`arm8` reach. */
export const TOWER_TYPES: readonly TowerType[] = [
  "arc",
  "stutter",
  "rime",
  "flak",
  "bloom",
  "lance",
  "forge",
  "sink",
];

/** Per level above the first, applied once per level. */
export const UPGRADE_DAMAGE = 1.6;
export const UPGRADE_RANGE = 1.0;
export const UPGRADE_FIRE_RATE = 1.15;
export const UPGRADE_HEAT = 1.3;
/** The cost multiple of the build cost to reach level II, then level III. */
export const UPGRADE_COST_MULT: readonly number[] = [1.0, 1.8];
export const MAX_LEVEL = 3;

/** The Rime's cold-slow ceiling by level. */
export const RIME_SLOW_CEIL: readonly number[] = [0.55, 0.68, 0.8];
/** The Forge's thermostat setpoint by level. */
export const FORGE_SETPOINT: readonly number[] = [72, 84, 96];
/** The Sink's per-shared-edge cooling by level. */
export const SINK_OUTPUT: readonly number[] = [16, 24, 36];

/** The Bloom's splash radius, in tiles. */
export const BLOOM_SPLASH = 2.4;
/** How long a Rime's slow lasts, in seconds. */
export const SLOW_TIME = 1.5;

// ---- Surge (specs/surge.md) ----------------------------------------------

export const SURGE_TYPES: readonly SurgeType[] = [
  "mote",
  "sprint",
  "hulk",
  "swarm",
  "drift",
  "core",
];

/** The per-wave hp scaling every unit of wave `w` carries. */
export function hpScale(w: number): number {
  return 1 + 0.62 * (w - 1);
}

// ---- The run (specs/waves.md) --------------------------------------------

/** Seconds a between-wave build phase begins with. */
export const BUILD_PHASE_TIME = 15;
/** Seconds of game time between two releases of a wave. */
export const WAVE_SPAWN_INTERVAL = 0.6;

/** The types the opening eight waves field, in order. */
export const WAVE_OPENING: readonly SurgeType[] = [
  "mote",
  "mote",
  "sprint",
  "swarm",
  "mote",
  "drift",
  "mote",
  "hulk",
];
/** The five types every wave after the eighth cycles. */
export const WAVE_CYCLE: readonly SurgeType[] = [
  "mote",
  "sprint",
  "swarm",
  "drift",
  "hulk",
];

/** How many units a wave-1 wave of each type releases. */
export const WAVE_BASE_COUNT: Record<SurgeType, number> = {
  mote: 12,
  sprint: 10,
  swarm: 24,
  drift: 8,
  hulk: 5,
  core: 1,
};
/** How fast a wave's size grows with the wave number. */
export const WAVE_GROWTH = 0.22;

// ---- Economy (specs/economy.md) ------------------------------------------

export const INTEREST_RATE = 0.08;
export const INTEREST_CAP = 40;
export const WAVE_CLEAR_BASE = 20;
export const WAVE_CLEAR_PER_WAVE = 5;
export const EARLY_SEND_PER_SECOND = 1;
export const REFUND_RATE = 0.7;
export const SCORE_WAVE_CLEAR = 100;
export const SCORE_VICTORY_PER_LIFE = 250;

// ---- Modes (specs/modes.md) ----------------------------------------------

export const MODES: readonly ModeId[] = [
  "containment",
  "hundred",
  "deeppockets",
  "bottleneck",
  "suddendeath",
];

export const DIFFICULTIES: readonly DifficultyId[] = ["easy", "medium", "hard"];

/** Containment's starting money and wave count, by difficulty. */
export const DIFFICULTY_TABLE: Record<
  DifficultyId,
  { money: number; waves: number }
> = {
  easy: { money: 350, waves: 15 },
  medium: { money: 250, waves: 20 },
  hard: { money: 200, waves: 26 },
};

export const START_LIVES = 20;
export const SUDDEN_DEATH_LIVES = 1;

export const HUNDRED_UNITS = 100;
export const HUNDRED_HP_SCALE = 6.0;
export const HUNDRED_MONEY = 600;
export const DEEP_POCKETS_MONEY = 10000;
export const BOTTLENECK_MONEY = 300;
export const SUDDEN_DEATH_MONEY = 300;

/** The only zone a mode restricts building to, inclusive at both ends. */
export const BOTTLENECK_ZONE = { col0: 13, row0: 8, col1: 36, row1: 27 };

// ---- Screen copy (specs/screens.md, specs/hud.md) ------------------------

export const TITLE_TEXT = "MELTDOWN";
export const TAGLINE_TEXT = "RUN IT HOT";
export const TITLE_ITEMS: readonly string[] = ["PLAY", "HOW TO PLAY"];
export const MODE_ITEMS: readonly string[] = [
  "CONTAINMENT",
  "THE HUNDRED",
  "DEEP POCKETS",
  "BOTTLENECK",
  "SUDDEN DEATH",
  "BACK",
];
export const DIFFICULTY_ITEMS: readonly string[] = [
  "EASY",
  "MEDIUM",
  "HARD",
  "BACK",
];

/** The one row the how-to screen draws (specs/screens.md). */
export const HOWTO_ITEMS: readonly string[] = ["BACK"];
export const PAUSE_ITEMS: readonly string[] = [
  "RESUME",
  "RESTART",
  "QUIT TO MENU",
];
export const ENDING_ITEMS: readonly string[] = ["PLAY AGAIN", "MENU"];

export const HUD_WAVE_LABEL = "WAVE";
export const HUD_MONEY_LABEL = "MONEY";
export const HUD_LIVES_LABEL = "LIVES";

/** The smallest a panel control may be drawn, in logical units. */
export const MIN_TOUCH_TARGET = 32;

// ---- Input (specs/controls.md) -------------------------------------------

/** Every action the game answers to. */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "pause",
  "mute",
  "arm1",
  "arm2",
  "arm3",
  "arm4",
  "arm5",
  "arm6",
  "arm7",
  "arm8",
  "rotate",
  "send",
  "speed",
  "upgrade",
  "sell",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The physical key each action is bound to, as a `KeyboardEvent.code`. No key
 * drives two actions, so nothing is double-fired.
 */
export const BINDINGS: Record<ActionName, readonly string[]> = {
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  left: ["ArrowLeft"],
  right: ["ArrowRight"],
  confirm: ["Enter"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
  arm1: ["Digit1"],
  arm2: ["Digit2"],
  arm3: ["Digit3"],
  arm4: ["Digit4"],
  arm5: ["Digit5"],
  arm6: ["Digit6"],
  arm7: ["Digit7"],
  arm8: ["Digit8"],
  rotate: ["KeyR"],
  send: ["Space"],
  speed: ["KeyF"],
  upgrade: ["KeyU"],
  sell: ["KeyS"],
};

// ---- Audio (specs/audio.md) ----------------------------------------------

/** The ten cue names, one per event. */
export const CUES = {
  fire: "fire",
  trip: "trip",
  death: "death",
  leak: "leak",
  place: "place",
  sell: "sell",
  waveClear: "wave-clear",
  victory: "victory",
  gameOver: "game-over",
  menu: "menu",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

// ---- The debug surface (specs/instrumentation.md) ------------------------

/** The version the surface reports. */
export const MELTDOWN_DEBUG_VERSION = 1;
/** The seed `reset` uses when none is named. */
export const DEFAULT_SEED = 1;
