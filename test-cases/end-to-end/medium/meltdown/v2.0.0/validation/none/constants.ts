// Meltdown — every figure the specification fixes, restated on the validator's
// side. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT AN IMPORT. An engineless run
// seeds no `src/` (specs/overview.md): the build writes every figure of the
// specification itself, from the specs alone. So there is nothing to import, and
// there must not be — a check that compared a build's constant against the
// build's own constant would grade nothing at all. Every value below is
// transcribed from the spec file named beside it, and THE SPEC IS
// AUTHORITATIVE: where this file and a spec file disagree, this file is wrong.
//
// WHAT IS DELIBERATELY ABSENT.
//
//   - NO COLOUR AND NO FONT. `specs/overview.md` fixes no palette and no
//     typeface: it states what a player must be able to READ, and leaves the
//     look to the build. So every presentation check compares two things the
//     build drew and states its own distance, and none of them has a hex value
//     to compare against.
//   - NO PANEL LAYOUT. Where the panel put each control is the build's, and the
//     snapshot's `controls` block reports it (specs/hud.md), so a scripted
//     scenario taps the rectangle the build named rather than one this file
//     would otherwise have to invent.
//   - NO CUE NAMES. `specs/audio.md` fixes ten of them, but an engineless build
//     writes its whole audio layer and there is no bus to ask, so a cue's NAME
//     is unobservable from out here. NO CHECK IN THIS PROJECT MAY ASSERT ONE,
//     and listing them would only invite it. What is observable is that a sound
//     was emitted and on which frame; `audio-init.js` says why that is the
//     honest reading.
//   - NO TOLERANCES. Every bound a check asserts is stated in that check, next
//     to the figure the specification fixes for it.

/* -------------------------------------------------------------------------- */
/* The vocabulary                                                             */
/* -------------------------------------------------------------------------- */

/** The eight screens the game is on exactly one of (specs/screens.md). */
export type Screen =
  | "title"
  | "modeselect"
  | "difficultyselect"
  | "howto"
  | "playing"
  | "paused"
  | "victory"
  | "gameover";

/** The three sub-phases of the `playing` screen (specs/waves.md). */
export type Phase = "opening" | "building" | "wave";

/** The five modes, in the order the mode-select list shows them (specs/modes.md). */
export const MODES = [
  "containment",
  "hundred",
  "deeppockets",
  "bottleneck",
  "suddendeath",
] as const;

export type ModeId = (typeof MODES)[number];

/** Containment's three difficulties (specs/modes.md). */
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type DifficultyId = (typeof DIFFICULTIES)[number];

/**
 * The eight towers in shop order, which is also the order `arm1`..`arm8` reach
 * (specs/towers.md, specs/controls.md).
 */
export const TOWER_TYPES = [
  "arc",
  "stutter",
  "rime",
  "flak",
  "bloom",
  "lance",
  "forge",
  "sink",
] as const;

export type TowerType = (typeof TOWER_TYPES)[number];

/** The six surge types (specs/surge.md). */
export const SURGE_TYPES = [
  "mote",
  "sprint",
  "hulk",
  "swarm",
  "drift",
  "core",
] as const;

export type SurgeType = (typeof SURGE_TYPES)[number];

/** The four faces in the order a rotation turns them (specs/towers.md). */
export const SIDES = ["N", "E", "S", "W"] as const;

/** A footprint face, local or world (specs/towers.md). */
export type Side = (typeof SIDES)[number];

/** A placement rotation: each step a further 90 degrees (specs/towers.md). */
export type Rotation = 0 | 1 | 2 | 3;

/** The two vents the surge enters through (specs/floor.md). */
export type Vent = "left" | "top";

/** The two exhausts it leaves through (specs/floor.md). */
export type Exhaust = "right" | "bottom";

/** A tower's level (specs/towers.md). */
export type Level = 1 | 2 | 3;

/** The game-speed toggle (specs/waves.md). */
export type Speed = 1 | 2;

/** One tile of the floor. */
export interface Tile {
  col: number;
  row: number;
}

/** A rectangle in logical stage units, as the panel reports a control. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/* -------------------------------------------------------------------------- */
/* Stage, panel and floor (specs/overview.md, specs/floor.md)                 */
/* -------------------------------------------------------------------------- */

/** The fixed logical stage everything is drawn and measured in. */
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
export const FLOOR_X0 = 18;
export const FLOOR_Y0 = 18;
export const FLOOR_W = 950;
export const FLOOR_H = 684;
export const FLOOR_X1 = 968;
export const FLOOR_Y1 = 702;

/** The reactor region, and the build panel's strip beside it. */
export const REACTOR_W = 986;
export const PANEL_X = 986;
export const PANEL_W = 294;

/** Tile `(c, r)`'s top-left corner on the stage. */
export function tileLeft(c: number): number {
  return FLOOR_X0 + TILE * c;
}
export function tileTop(r: number): number {
  return FLOOR_Y0 + TILE * r;
}

/** Tile `(c, r)`'s CENTRE on the stage: what a caller aiming at a tile passes. */
export function tileCX(c: number): number {
  return FLOOR_X0 + TILE * c + TILE / 2;
}
export function tileCY(r: number): number {
  return FLOOR_Y0 + TILE * r + TILE / 2;
}

/** The tile a stage position falls in. May be off the grid. */
export function colAt(x: number): number {
  return Math.floor((x - FLOOR_X0) / TILE);
}
export function rowAt(y: number): number {
  return Math.floor((y - FLOOR_Y0) / TILE);
}

/** Whether a tile address lies on the grid. */
export function inBounds(c: number, r: number): boolean {
  return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

/** A `size x size` footprint's centre: the point range is measured from. */
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

/** Every tile a `size x size` footprint anchored at `(col, row)` covers. */
export function footprintTiles(col: number, row: number, size: number): Tile[] {
  const tiles: Tile[] = [];
  for (let dr = 0; dr < size; dr += 1) {
    for (let dc = 0; dc < size; dc += 1)
      tiles.push({ col: col + dc, row: row + dr });
  }
  return tiles;
}

/* -------------------------------------------------------------------------- */
/* The openings (specs/floor.md)                                              */
/* -------------------------------------------------------------------------- */

export const LEFT_VENT_ROWS: readonly number[] = [16, 17, 18, 19];
export const RIGHT_EXHAUST_ROWS: readonly number[] = [16, 17, 18, 19];
export const TOP_VENT_COLS: readonly number[] = [
  22, 23, 24, 25, 26, 27, 28, 29,
];
export const BOTTOM_EXHAUST_COLS: readonly number[] = [
  22, 23, 24, 25, 26, 27, 28, 29,
];

/** Each vent's fixed opposite exhaust, assigned for a unit's whole life. */
export const OPPOSITE: Record<Vent, Exhaust> = { left: "right", top: "bottom" };

/** The floor edge tiles each opening opens onto. */
export const OPENING_TILES: Record<Vent | Exhaust, readonly Tile[]> = {
  left: LEFT_VENT_ROWS.map((row) => ({ col: 0, row })),
  top: TOP_VENT_COLS.map((col) => ({ col, row: 0 })),
  right: RIGHT_EXHAUST_ROWS.map((row) => ({ col: COLS - 1, row })),
  bottom: BOTTOM_EXHAUST_COLS.map((col) => ({ col, row: ROWS - 1 })),
};

/* -------------------------------------------------------------------------- */
/* Heat (specs/heat.md)                                                       */
/* -------------------------------------------------------------------------- */

/** The top of the heat scale, which is also the heat an emitter trips at. */
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

/* -------------------------------------------------------------------------- */
/* Towers (specs/towers.md)                                                   */
/* -------------------------------------------------------------------------- */

/** One of the six emitters, as `specs/towers.md` tabulates it at level I. */
export interface EmitterDef {
  kind: "emitter";
  /** The footprint's side, in tiles. */
  size: number;
  /** The build cost, in money. */
  cost: number;
  /** Range as a radius in tiles. */
  range: number;
  /** Shots per second. */
  fireRate: number;
  /** Damage one shot removes before the heat multiplier. */
  baseDamage: number;
  /** Heat one shot adds before mass divides it. */
  heatPerShot: number;
  /** Where the damage plateau starts. Unchanged by level. */
  redline: number;
  /** The thermal mass that divides every change to this tower's heat. */
  mass: number;
  /** The faces that shed heat well, in the tower's LOCAL orientation. */
  radiators: readonly Side[];
  /** The Flak alone: it targets flying units and ignores every ground unit. */
  airOnly?: boolean;
  /** The Bloom alone: the radius, in tiles, its shot damages around its target. */
  splash?: number;
  /** The Rime alone: its cold-slow ceiling by level. */
  slowCeil?: readonly number[];
}

/** The Forge or the Sink: never fires, carries no heat, only moves it. */
export interface MoverDef {
  kind: "forge" | "sink";
  size: number;
  cost: number;
  /** The Forge's setpoint, or the Sink's per-shared-edge cooling, by level. */
  output: readonly number[];
}

export type TowerDef = EmitterDef | MoverDef;

/** Per level above the first, applied once per level (specs/towers.md). */
export const UPGRADE_DAMAGE = 1.6;
export const UPGRADE_RANGE = 1.0;
export const UPGRADE_FIRE_RATE = 1.15;
export const UPGRADE_HEAT = 1.3;
/** The multiple of the build cost to reach level II, then level III. */
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

/** The roster, in shop order. */
export const TOWER_DEFS: Record<TowerType, TowerDef> = {
  arc: {
    kind: "emitter",
    size: 2,
    cost: 15,
    range: 6.0,
    fireRate: 2.0,
    baseDamage: 6,
    heatPerShot: 10.3,
    redline: 80,
    mass: 1.0,
    radiators: ["N", "S"],
  },
  stutter: {
    kind: "emitter",
    size: 2,
    cost: 40,
    range: 5.0,
    fireRate: 7.0,
    baseDamage: 2.0,
    heatPerShot: 4.2,
    redline: 60,
    mass: 0.5,
    radiators: ["N", "E"],
  },
  rime: {
    kind: "emitter",
    size: 2,
    cost: 45,
    range: 5.5,
    fireRate: 2.4,
    baseDamage: 4,
    heatPerShot: 7.0,
    redline: 100,
    mass: 1.1,
    radiators: ["N", "S", "E"],
    slowCeil: RIME_SLOW_CEIL,
  },
  flak: {
    kind: "emitter",
    size: 2,
    cost: 60,
    range: 8.0,
    fireRate: 2.6,
    baseDamage: 6,
    heatPerShot: 9.6,
    redline: 78,
    mass: 0.9,
    radiators: ["N", "S"],
    airOnly: true,
  },
  bloom: {
    kind: "emitter",
    size: 3,
    cost: 150,
    range: 6.0,
    fireRate: 1.2,
    baseDamage: 10,
    heatPerShot: 27.3,
    redline: 82,
    mass: 1.8,
    radiators: ["N", "E"],
    splash: BLOOM_SPLASH,
  },
  lance: {
    kind: "emitter",
    size: 4,
    cost: 150,
    range: 12.0,
    fireRate: 0.8,
    baseDamage: 43,
    heatPerShot: 48.9,
    redline: 92,
    mass: 2.8,
    radiators: ["N", "E"],
  },
  forge: { kind: "forge", size: 2, cost: 20, output: FORGE_SETPOINT },
  sink: { kind: "sink", size: 2, cost: 20, output: SINK_OUTPUT },
};

/** Whether a roster entry is one of the six emitters. */
export function isEmitter(def: TowerDef): def is EmitterDef {
  return def.kind === "emitter";
}

/** Whether a type is one of the six emitters. */
export function isEmitterType(type: TowerType): boolean {
  return isEmitter(TOWER_DEFS[type]);
}

/** The six emitter types, in shop order. */
export const EMITTER_TYPES: readonly TowerType[] =
  TOWER_TYPES.filter(isEmitterType);

/** The two mover types, in shop order. */
export const MOVER_TYPES: readonly TowerType[] = TOWER_TYPES.filter(
  (type) => !isEmitterType(type),
);

/** An emitter's figures at a level, every per-level multiplier applied. */
export interface EmitterStats {
  range: number;
  fireRate: number;
  baseDamage: number;
  heatPerShot: number;
  redline: number;
  /** The Rime's cold-slow ceiling at this level; `0` on every other emitter. */
  slowCeil: number;
}

/** An emitter's stats at `level`, applied once per level above the first. */
export function emitterStats(def: EmitterDef, level: number): EmitterStats {
  const n = level - 1;
  return {
    range: def.range + UPGRADE_RANGE * n,
    fireRate: def.fireRate * UPGRADE_FIRE_RATE ** n,
    baseDamage: def.baseDamage * UPGRADE_DAMAGE ** n,
    heatPerShot: def.heatPerShot * UPGRADE_HEAT ** n,
    redline: def.redline,
    slowCeil: def.slowCeil === undefined ? 0 : def.slowCeil[n],
  };
}

/** A mover's own figure at `level`: the Forge's setpoint, or the Sink's output. */
export function moverOutput(def: MoverDef, level: number): number {
  return def.output[level - 1];
}

/** What it costs to take a tower from `level` to the next; `0` at the ceiling. */
export function upgradeCost(def: TowerDef, level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return Math.round(def.cost * UPGRADE_COST_MULT[level - 1]);
}

/** The Rime's live slow fraction at `heat`, at `level` (specs/combat.md). */
export function rimeSlowFactor(heat: number, level: number): number {
  return RIME_SLOW_CEIL[level - 1] * (1 - heat / TRIP_HEAT);
}

/**
 * A tower's world-oriented radiator faces at `rotation`.
 *
 * A rotation turns a local face `N -> E -> S -> W`, so rotation `1` turns a
 * local `N` into a world `E` (specs/towers.md). Movers have none at any
 * rotation.
 */
export function worldRadiators(
  type: TowerType,
  rotation: number,
): readonly Side[] {
  const def = TOWER_DEFS[type];
  if (!isEmitter(def)) return [];
  return def.radiators.map(
    (side) => SIDES[(SIDES.indexOf(side) + rotation) % SIDES.length],
  );
}

/* -------------------------------------------------------------------------- */
/* The surge (specs/surge.md)                                                 */
/* -------------------------------------------------------------------------- */

/** One surge type, as `specs/surge.md` tabulates it. */
export interface SurgeDef {
  /** Base hp, before the wave's scaling. */
  hp: number;
  /** Base speed, in logical units per second. */
  speed: number;
  slowable: boolean;
  flies: boolean;
  /** The money and score a kill pays. */
  bounty: number;
  /** The lives a leak costs. */
  leak: number;
}

export const SURGE_DEFS: Record<SurgeType, SurgeDef> = {
  mote: { hp: 40, speed: 60, slowable: true, flies: false, bounty: 3, leak: 1 },
  sprint: {
    hp: 24,
    speed: 120,
    slowable: true,
    flies: false,
    bounty: 3,
    leak: 1,
  },
  hulk: {
    hp: 220,
    speed: 38,
    slowable: true,
    flies: false,
    bounty: 7,
    leak: 2,
  },
  swarm: {
    hp: 12,
    speed: 70,
    slowable: true,
    flies: false,
    bounty: 2,
    leak: 1,
  },
  drift: { hp: 60, speed: 80, slowable: true, flies: true, bounty: 6, leak: 1 },
  core: {
    hp: 1600,
    speed: 30,
    slowable: false,
    flies: false,
    bounty: 90,
    leak: 5,
  },
};

/** The per-wave hp scaling every unit of wave `w` carries (specs/waves.md). */
export function hpScale(w: number): number {
  return 1 + 0.62 * (w - 1);
}

/* -------------------------------------------------------------------------- */
/* The run (specs/waves.md)                                                   */
/* -------------------------------------------------------------------------- */

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

/** The two waves of an `n`-wave run that field the Core. */
export function milestoneWaves(n: number): [number, number] {
  return [Math.round(n / 2), n];
}

/** Whether wave `w` of an `n`-wave run is one of the two milestones. */
export function isMilestone(w: number, n: number): boolean {
  const [mid, last] = milestoneWaves(n);
  return w === mid || w === last;
}

/** The single type wave `w` of an `n`-wave run fields. */
export function waveType(w: number, n: number): SurgeType {
  if (isMilestone(w, n)) return "core";
  if (w <= WAVE_OPENING.length) return WAVE_OPENING[w - 1];
  return WAVE_CYCLE[(w - (WAVE_OPENING.length + 1)) % WAVE_CYCLE.length];
}

/** How many units wave `w` of an `n`-wave run releases. */
export function waveSize(w: number, n: number): number {
  const type = waveType(w, n);
  if (type === "core") return 1;
  return Math.ceil(WAVE_BASE_COUNT[type] * (1 + WAVE_GROWTH * (w - 1)));
}

/**
 * The type of the `index`-th unit of The Hundred's onslaught, counted from `0`.
 *
 * The one wave in the game that fields more than one type: it cycles
 * `WAVE_CYCLE` a unit at a time (specs/modes.md).
 */
export function hundredTypeAt(index: number): SurgeType {
  return WAVE_CYCLE[index % WAVE_CYCLE.length];
}

/* -------------------------------------------------------------------------- */
/* Economy (specs/economy.md)                                                 */
/* -------------------------------------------------------------------------- */

export const INTEREST_RATE = 0.08;
export const INTEREST_CAP = 40;
export const WAVE_CLEAR_BASE = 20;
export const WAVE_CLEAR_PER_WAVE = 5;
export const EARLY_SEND_PER_SECOND = 1;
export const REFUND_RATE = 0.7;
export const SCORE_WAVE_CLEAR = 100;
export const SCORE_VICTORY_PER_LIFE = 250;

/* -------------------------------------------------------------------------- */
/* Modes (specs/modes.md)                                                     */
/* -------------------------------------------------------------------------- */

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

/** The rectangle of tiles a mode restricts building to, both ends included. */
export interface BuildZone {
  col0: number;
  row0: number;
  col1: number;
  row1: number;
}

/** The only zone a mode restricts building to. */
export const BOTTLENECK_ZONE: BuildZone = {
  col0: 13,
  row0: 8,
  col1: 36,
  row1: 27,
};

/** Everything a mode and a difficulty fix, and nothing they do not. */
export interface ModeFigures {
  startMoney: number;
  waveCount: number;
  startLives: number;
  /** Whether entering a build phase between waves pays interest. */
  interest: boolean;
  /** Whether the run has build phases between waves at all. */
  buildPhases: boolean;
  /** The zone building is restricted to, or `null` for the whole floor. */
  buildZone: BuildZone | null;
}

/** `MODE_TABLE`: the figures `mode` and `difficulty` derive (specs/modes.md). */
export const MODE_TABLE: Record<
  ModeId,
  (difficulty: DifficultyId) => ModeFigures
> = {
  containment: (difficulty) => ({
    startMoney: DIFFICULTY_TABLE[difficulty].money,
    waveCount: DIFFICULTY_TABLE[difficulty].waves,
    startLives: START_LIVES,
    interest: true,
    buildPhases: true,
    buildZone: null,
  }),
  hundred: () => ({
    startMoney: HUNDRED_MONEY,
    waveCount: 1,
    startLives: START_LIVES,
    interest: false,
    buildPhases: false,
    buildZone: null,
  }),
  deeppockets: () => ({
    startMoney: DEEP_POCKETS_MONEY,
    waveCount: 20,
    startLives: START_LIVES,
    interest: false,
    buildPhases: true,
    buildZone: null,
  }),
  bottleneck: () => ({
    startMoney: BOTTLENECK_MONEY,
    waveCount: 20,
    startLives: START_LIVES,
    interest: true,
    buildPhases: true,
    buildZone: { ...BOTTLENECK_ZONE },
  }),
  suddendeath: () => ({
    startMoney: SUDDEN_DEATH_MONEY,
    waveCount: 20,
    startLives: SUDDEN_DEATH_LIVES,
    interest: true,
    buildPhases: true,
    buildZone: null,
  }),
};

/** The figures `mode` and `difficulty` derive. */
export function modeFigures(
  mode: ModeId,
  difficulty: DifficultyId,
): ModeFigures {
  return MODE_TABLE[mode](difficulty);
}

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/screens.md, specs/hud.md)                               */
/* -------------------------------------------------------------------------- */

export const TITLE_TEXT = "MELTDOWN";
export const TAGLINE_TEXT = "RUN IT HOT";
export const TITLE_ITEMS: readonly string[] = ["PLAY", "HOW TO PLAY"];
export const MODE_ITEMS: readonly string[] = [
  "CONTAINMENT",
  "THE HUNDRED",
  "DEEP POCKETS",
  "BOTTLENECK",
  "SUDDEN DEATH",
];
export const DIFFICULTY_ITEMS: readonly string[] = ["EASY", "MEDIUM", "HARD"];
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

/* -------------------------------------------------------------------------- */
/* Input (specs/controls.md)                                                  */
/* -------------------------------------------------------------------------- */

/** Every action the game answers to, in the order the spec tabulates them. */
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
 * The physical key each action is bound to, as a `KeyboardEvent.code`.
 *
 * No key drives two actions, so nothing is double-fired. An engineless build
 * writes its own keyboard layer and reads these codes off the page itself, so a
 * check drives a REAL key through Chromium rather than posing an action.
 */
export const BINDINGS: Record<ActionName, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  confirm: "Enter",
  back: "Escape",
  pause: "KeyP",
  mute: "KeyM",
  arm1: "Digit1",
  arm2: "Digit2",
  arm3: "Digit3",
  arm4: "Digit4",
  arm5: "Digit5",
  arm6: "Digit6",
  arm7: "Digit7",
  arm8: "Digit8",
  rotate: "KeyR",
  send: "Space",
  speed: "KeyF",
  upgrade: "KeyU",
  sell: "KeyS",
};

/** The key the read-only debug overlay is shown and hidden by. */
export const OVERLAY_KEY = "Backquote";

/**
 * A key nothing is bound to, for the one thing that needs a REAL browser gesture
 * and no game effect: opening the build's audio.
 *
 * `specs/controls.md` binds every key above and `Backquote` and no other, so a
 * press of this one reaches the build's keyboard layer, satisfies the browser's
 * autoplay gate, and changes nothing a check is reading.
 */
export const UNBOUND_KEY = "KeyZ";

/* -------------------------------------------------------------------------- */
/* The debug surface (specs/instrumentation.md)                               */
/* -------------------------------------------------------------------------- */

/** The version the surface reports. */
export const MELTDOWN_DEBUG_VERSION = 1;
/** The seed `reset` uses when none is named. */
export const DEFAULT_SEED = 1;
