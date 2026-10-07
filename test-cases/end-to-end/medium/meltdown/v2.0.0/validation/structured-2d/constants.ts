// Meltdown — every figure the specification fixes, restated on the validator's
// side. CASE-PROVIDED.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT AN IMPORT. This project grades a build
// that WAS seeded a `src/constants.ts` of its own. That is exactly why nothing
// here reads it. A check that compared a build's figure against the build's own
// figure would grade nothing at all: a build that walks a Mote at 66 when
// `specs/surge.md` says 60 agrees with itself, and every assertion drawn from
// its own table would pass. So an ASSERTED FIGURE BELONGS TO THE VALIDATOR.
// Every value below is transcribed from the spec file named beside it, and THE
// SPEC IS AUTHORITATIVE: where this file and a spec file disagree, this file is
// wrong.
//
// NOTHING HERE IMPORTS `../src/constants`, AND THAT IS THE WHOLE POINT.
// The one thing a validator may legitimately read off the build is a value the
// specification leaves to the build — a layout it was free to pick, geometry it
// was free to place — read to DRIVE the build or to LOCATE what it drew, never
// compared against. Meltdown leaves no such value: `specs/controls.md` names the
// layout (`dpad-4`) as well as every binding, `specs/overview.md` fixes the
// stage, and `specs/floor.md` fixes the grid. So this file states everything and
// imports nothing, and no other file in this project may import the build's
// constants either.
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
//   - NO TOLERANCES. Every bound a check asserts is stated in that check, next
//     to the figure the specification fixes for it.

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

/** The build panel's strip beside the reactor region. */
export const PANEL_X = 986;
export const PANEL_W = 294;

/** Tile `(c, r)`'s top-left corner on the stage. */
export const tileLeft = (c: number): number => FLOOR_X0 + c * TILE;
export const tileTop = (r: number): number => FLOOR_Y0 + r * TILE;

/** Tile `(c, r)`'s CENTRE on the stage: what a caller aiming at a tile passes. */
export const tileCX = (c: number): number => FLOOR_X0 + c * TILE + TILE / 2;
export const tileCY = (r: number): number => FLOOR_Y0 + r * TILE + TILE / 2;

/** Whether a tile address lies on the grid. */
export const inBounds = (c: number, r: number): boolean =>
  c >= 0 && c < COLS && r >= 0 && r < ROWS;

/**
 * The CENTRE of a `size` x `size` footprint anchored at `(col, row)`: the point
 * range is measured from, and the point a tower reports as its own position.
 */
export const footprintCentre = (
  col: number,
  row: number,
  size: number,
): { x: number; y: number } => ({
  x: tileLeft(col) + (size * TILE) / 2,
  y: tileTop(row) + (size * TILE) / 2,
});

/* -------------------------------------------------------------------------- */
/* The openings (specs/floor.md)                                              */
/* -------------------------------------------------------------------------- */

export const LEFT_VENT_ROWS = [16, 17, 18, 19] as const;
export const RIGHT_EXHAUST_ROWS = [16, 17, 18, 19] as const;
export const TOP_VENT_COLS = [22, 23, 24, 25, 26, 27, 28, 29] as const;
export const BOTTOM_EXHAUST_COLS = [22, 23, 24, 25, 26, 27, 28, 29] as const;

/**
 * Each vent's FIXED opposite exhaust. A unit entering at a vent is assigned that
 * vent's opposite and never the nearer one, for its whole life.
 */
export const OPPOSITE = { left: "right", top: "bottom" } as const;

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
export const heatMultiplier = (h: number, redline: number): number =>
  MIN_HEAT_MULT +
  (MAX_HEAT_MULT - MIN_HEAT_MULT) * Math.pow(Math.min(h, redline) / redline, 2);

/* -------------------------------------------------------------------------- */
/* Towers (specs/towers.md)                                                   */
/* -------------------------------------------------------------------------- */

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

/** A radiator face, in LOCAL orientation. A placement rotation turns them. */
export type Face = "N" | "E" | "S" | "W";

/** One of the six emitters, as `specs/towers.md` tabulates it at level I. */
export interface EmitterDef {
  readonly kind: "emitter";
  /** Build cost, in money. */
  readonly cost: number;
  /** Footprint size, in tiles on a side. */
  readonly size: 2 | 3 | 4;
  /** Range, as a radius in TILES from the footprint centre. */
  readonly range: number;
  /** Shots per second at level I. */
  readonly fireRate: number;
  /** Damage per shot at level I, BEFORE the heat multiplier. */
  readonly baseDamage: number;
  /** Heat added by one shot at level I, before thermal mass divides it. */
  readonly heatPerShot: number;
  /** The heat this emitter reaches full power at; unchanged by level. */
  readonly redline: number;
  /** Thermal mass: it divides every change to this tower's heat. */
  readonly mass: number;
  /** Radiator faces, in LOCAL orientation at rotation 0. */
  readonly radiators: readonly Face[];
}

/** The Forge or the Sink: never fires, carries no heat, only moves it. */
export interface MoverDef {
  readonly kind: "mover";
  readonly cost: number;
  readonly size: 2;
  /** A mover carries no heat, no radiator faces and no rotation. */
  readonly radiators: readonly [];
}

export type TowerDef = EmitterDef | MoverDef;

/**
 * The stat table `specs/towers.md` fixes. The Rime is an ORDINARY EMITTER: base
 * damage 4, redline 100.
 */
export const TOWER_DEFS: Readonly<Record<TowerType, TowerDef>> = {
  arc: {
    kind: "emitter",
    cost: 15,
    size: 2,
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
    cost: 40,
    size: 2,
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
    cost: 45,
    size: 2,
    range: 5.5,
    fireRate: 2.4,
    baseDamage: 4,
    heatPerShot: 7.0,
    redline: 100,
    mass: 1.1,
    radiators: ["N", "S", "E"],
  },
  flak: {
    kind: "emitter",
    cost: 60,
    size: 2,
    range: 8.0,
    fireRate: 2.6,
    baseDamage: 6,
    heatPerShot: 9.6,
    redline: 78,
    mass: 0.9,
    radiators: ["N", "S"],
  },
  bloom: {
    kind: "emitter",
    cost: 150,
    size: 3,
    range: 6.0,
    fireRate: 1.2,
    baseDamage: 10,
    heatPerShot: 27.3,
    redline: 82,
    mass: 1.8,
    radiators: ["N", "E"],
  },
  lance: {
    kind: "emitter",
    cost: 150,
    size: 4,
    range: 12.0,
    fireRate: 0.8,
    baseDamage: 43,
    heatPerShot: 48.9,
    redline: 92,
    mass: 2.8,
    radiators: ["N", "E"],
  },
  forge: { kind: "mover", cost: 20, size: 2, radiators: [] },
  sink: { kind: "mover", cost: 20, size: 2, radiators: [] },
};

/** The highest level a tower reaches. */
export const MAX_LEVEL = 3;

/** Per level above the first, applied once per level (specs/towers.md). */
export const UPGRADE_DAMAGE = 1.6;
/** Range is ADDED, in tiles, not multiplied. */
export const UPGRADE_RANGE = 1.0;
export const UPGRADE_FIRE_RATE = 1.15;
export const UPGRADE_HEAT = 1.3;

/**
 * The cost of the next upgrade, as a multiple of the build cost: level II costs
 * `1.0` times it and level III `1.8` times it. Indexed by the tower's CURRENT
 * level minus one.
 */
export const UPGRADE_COST_MULT = [1.0, 1.8] as const;

/** The Rime's cold slow ceiling, per level. */
export const RIME_SLOW_CEIL = [0.55, 0.68, 0.8] as const;

/** The Forge's thermostat setpoint, per level. */
export const FORGE_SETPOINT = [72, 84, 96] as const;

/** The Sink's per-shared-edge cooling output, per level. */
export const SINK_OUTPUT = [16, 24, 36] as const;

/** The Bloom's splash radius, in tiles from the impact. */
export const BLOOM_SPLASH = 2.4;

/** How long a slow lasts, in seconds, however it was applied. */
export const SLOW_TIME = 1.5;

/**
 * An emitter's live stats at `level`. Size, redline, mass and the radiator
 * layout are untouched by an upgrade.
 */
export const emitterStats = (
  def: EmitterDef,
  level: number,
): {
  range: number;
  fireRate: number;
  baseDamage: number;
  heatPerShot: number;
} => {
  const steps = level - 1;
  return {
    range: def.range + UPGRADE_RANGE * steps,
    fireRate: def.fireRate * Math.pow(UPGRADE_FIRE_RATE, steps),
    baseDamage: def.baseDamage * Math.pow(UPGRADE_DAMAGE, steps),
    heatPerShot: def.heatPerShot * Math.pow(UPGRADE_HEAT, steps),
  };
};

/**
 * A mover's output at `level`: the Forge's setpoint, or the Sink's per-shared-
 * edge cooling.
 */
export const moverOutput = (type: "forge" | "sink", level: number): number =>
  type === "forge" ? FORGE_SETPOINT[level - 1] : SINK_OUTPUT[level - 1];

/**
 * What the next upgrade costs a tower currently at `level`, and `0` at
 * `MAX_LEVEL`.
 */
export const upgradeCost = (def: TowerDef, level: number): number =>
  level >= MAX_LEVEL ? 0 : Math.round(def.cost * UPGRADE_COST_MULT[level - 1]);

/* -------------------------------------------------------------------------- */
/* The surge (specs/surge.md)                                                 */
/* -------------------------------------------------------------------------- */

export const SURGE_TYPES = [
  "mote",
  "sprint",
  "hulk",
  "swarm",
  "drift",
  "core",
] as const;

export type SurgeType = (typeof SURGE_TYPES)[number];

/** One surge type, as `specs/surge.md` tabulates it. */
export interface SurgeDef {
  /** Base hp at wave 1, before the per-wave scaling. */
  readonly hp: number;
  /** Speed, in logical units per second. */
  readonly speed: number;
  /** Whether a Rime's slow touches it at all. */
  readonly slowable: boolean;
  /** Whether it ignores the maze and travels the straight line. */
  readonly flies: boolean;
  /** Money a kill pays. */
  readonly bounty: number;
  /** Lives a leak costs. */
  readonly leak: number;
}

export const SURGE_DEFS: Readonly<Record<SurgeType, SurgeDef>> = {
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

/**
 * The per-wave HP scaling. HP is the ONLY thing that scales: speeds, bounties
 * and leak values are the same on wave 20 as on wave 1 (specs/waves.md).
 */
export const hpScale = (w: number): number => 1 + 0.62 * (w - 1);

/* -------------------------------------------------------------------------- */
/* The run (specs/waves.md)                                                   */
/* -------------------------------------------------------------------------- */

/** The seconds a between-wave build phase runs before starting its wave. */
export const BUILD_PHASE_TIME = 15;

/** The seconds between one unit's release and the next, within a wave. */
export const WAVE_SPAWN_INTERVAL = 0.6;

/** The types waves 1 through 8 carry, in order. */
export const WAVE_OPENING = [
  "mote",
  "mote",
  "sprint",
  "swarm",
  "mote",
  "drift",
  "mote",
  "hulk",
] as const;

/** The types waves 9 and up cycle through. */
export const WAVE_CYCLE = ["mote", "sprint", "swarm", "drift", "hulk"] as const;

/**
 * The count a wave 1 of each type would release, before growth. Nothing asserts
 * this table directly; `waveSize` below is what the checks read.
 */
const WAVE_BASE_COUNT: Readonly<Record<SurgeType, number>> = {
  mote: 12,
  sprint: 10,
  swarm: 24,
  drift: 8,
  hulk: 5,
  core: 1,
};

/** How much longer each wave is than wave 1, per wave. */
const WAVE_GROWTH = 0.22;

/** The two waves of an `n`-wave run that are Core waves: the halfway one and the last. */
export const milestoneWaves = (n: number): readonly [number, number] => [
  Math.round(n / 2),
  n,
];

/** The single type wave `w` of an `n`-wave run carries. */
export const waveType = (w: number, n: number): SurgeType => {
  const [mid, last] = milestoneWaves(n);
  if (w === mid || w === last) return "core";
  if (w <= WAVE_OPENING.length) return WAVE_OPENING[w - 1];
  return WAVE_CYCLE[(w - (WAVE_OPENING.length + 1)) % WAVE_CYCLE.length];
};

/** How many units wave `w` of an `n`-wave run releases. */
export const waveSize = (w: number, n: number): number => {
  const type = waveType(w, n);
  if (type === "core") return 1;
  return Math.ceil(WAVE_BASE_COUNT[type] * (1 + WAVE_GROWTH * (w - 1)));
};

/* -------------------------------------------------------------------------- */
/* Economy (specs/economy.md)                                                 */
/* -------------------------------------------------------------------------- */

/** Interest paid on entering a between-wave build phase, and its ceiling. */
export const INTEREST_RATE = 0.08;
export const INTEREST_CAP = 40;

/** The wave-clear bonus: `WAVE_CLEAR_BASE + WAVE_CLEAR_PER_WAVE * w`. */
export const WAVE_CLEAR_BASE = 20;
export const WAVE_CLEAR_PER_WAVE = 5;

/** Money paid per whole second left on the clock when a wave is sent early. */
export const EARLY_SEND_PER_SECOND = 1;

/** The fraction of everything spent on a tower that selling it pays back. */
export const REFUND_RATE = 0.7;

/** The score a wave clear pays, per wave, and victory pays, per life left. */
export const SCORE_WAVE_CLEAR = 100;
export const SCORE_VICTORY_PER_LIFE = 250;

/* -------------------------------------------------------------------------- */
/* Modes (specs/modes.md)                                                     */
/* -------------------------------------------------------------------------- */

export const MODES = [
  "containment",
  "hundred",
  "deeppockets",
  "bottleneck",
  "suddendeath",
] as const;

export type ModeName = (typeof MODES)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type DifficultyName = (typeof DIFFICULTIES)[number];

/**
 * What a difficulty changes, and it changes NOTHING else: the starting money and
 * the number of waves. It applies to Containment alone; every other mode fixes
 * both figures in its own row.
 */
export const DIFFICULTY_TABLE: Readonly<
  Record<DifficultyName, { money: number; waves: number }>
> = {
  easy: { money: 350, waves: 15 },
  medium: { money: 250, waves: 20 },
  hard: { money: 200, waves: 26 },
};

/** The lives a run starts on, and the one life Sudden Death starts on. */
export const START_LIVES = 20;
export const SUDDEN_DEATH_LIVES = 1;

/** The Hundred: one wave of exactly this many units, each this much tougher. */
export const HUNDRED_UNITS = 100;
export const HUNDRED_HP_SCALE = 6.0;
export const HUNDRED_MONEY = 600;

export const DEEP_POCKETS_MONEY = 10000;
const BOTTLENECK_MONEY = 300;
const SUDDEN_DEATH_MONEY = 300;

/** The only tiles Bottleneck allows a footprint on, inclusive on both ends. */
export const BOTTLENECK_ZONE = {
  col0: 13,
  row0: 8,
  col1: 36,
  row1: 27,
} as const;

export interface ModeRow {
  /** `null` where the difficulty decides it. */
  readonly startMoney: number | null;
  readonly waveCount: number | null;
  readonly startLives: number;
  readonly interest: boolean;
  /** Whether the run has between-wave build phases at all. */
  readonly buildPhases: boolean;
  /** `null` where the whole floor may be built on. */
  readonly buildZone: typeof BOTTLENECK_ZONE | null;
}

/**
 * The derived-figures table of `specs/modes.md`. `waveCount`, `startMoney`,
 * `startLives`, `interest` and `buildZone` follow the mode and difficulty and
 * nothing else.
 */
export const MODE_TABLE: Readonly<Record<ModeName, ModeRow>> = {
  containment: {
    startMoney: null,
    waveCount: null,
    startLives: START_LIVES,
    interest: true,
    buildPhases: true,
    buildZone: null,
  },
  hundred: {
    startMoney: HUNDRED_MONEY,
    waveCount: 1,
    startLives: START_LIVES,
    interest: false,
    buildPhases: false,
    buildZone: null,
  },
  deeppockets: {
    startMoney: DEEP_POCKETS_MONEY,
    waveCount: 20,
    startLives: START_LIVES,
    interest: false,
    buildPhases: true,
    buildZone: null,
  },
  bottleneck: {
    startMoney: BOTTLENECK_MONEY,
    waveCount: 20,
    startLives: START_LIVES,
    interest: true,
    buildPhases: true,
    buildZone: BOTTLENECK_ZONE,
  },
  suddendeath: {
    startMoney: SUDDEN_DEATH_MONEY,
    waveCount: 20,
    startLives: SUDDEN_DEATH_LIVES,
    interest: true,
    buildPhases: true,
    buildZone: null,
  },
};

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/screens.md, specs/hud.md)                               */
/* -------------------------------------------------------------------------- */

export const TITLE_TEXT = "MELTDOWN";
export const TAGLINE_TEXT = "RUN IT HOT";

export const TITLE_ITEMS = ["PLAY", "HOW TO PLAY"] as const;
export const MODE_ITEMS = [
  "CONTAINMENT",
  "THE HUNDRED",
  "DEEP POCKETS",
  "BOTTLENECK",
  "SUDDEN DEATH",
  "BACK",
] as const;
export const DIFFICULTY_ITEMS = ["EASY", "MEDIUM", "HARD", "BACK"] as const;
export const HOWTO_ITEMS = ["BACK"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const ENDING_ITEMS = ["PLAY AGAIN", "MENU"] as const;

export const HUD_WAVE_LABEL = "WAVE";
export const HUD_MONEY_LABEL = "MONEY";
export const HUD_LIVES_LABEL = "LIVES";

/**
 * The smallest side a panel control may be drawn at, in logical units.
 *
 * `specs/hud.md` states the figure for the panel's controls and
 * `specs/screens.md` names it again for a menu row, so one transcription serves
 * both.
 */
export const MIN_TOUCH_TARGET = 32;

/* -------------------------------------------------------------------------- */
/* Input (specs/controls.md)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The action layout the game registers, which `specs/controls.md` NAMES: "The
 * game registers the layout `LAYOUT` (`dpad-4`)". It is not the build's to pick,
 * so it is stated here rather than read off the build, and the harness registers
 * this layout when it stands the engine up in place of `src/main.ts`.
 */
export const LAYOUT = "dpad-4";

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
 * The key each action is bound to, from the binding table of
 * `specs/controls.md`, as `KeyboardEvent.code` values so a binding is a physical
 * key rather than a layout-dependent character.
 *
 * The engine takes a LIST of keys per action; the specification names exactly
 * one key for each and adds "No key drives two actions", so every list here is
 * one key long and no code appears twice.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
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

/* -------------------------------------------------------------------------- */
/* Audio cues (specs/audio.md)                                                */
/* -------------------------------------------------------------------------- */

/**
 * The ten cue names, one per event, as the cue table of `specs/audio.md` fixes
 * them. Under an engine the bus reports the name of every cue it played, so a
 * check CAN assert which cue answered an event — and does, which is why the
 * names are stated here rather than read back off the build.
 */
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
