// Meltdown — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation. Where a
// spec file states a figure it cites the name here; where it states a rule, the
// rule is expressed here as a function.
//
// Every value is in the fixed 1280x720 logical coordinate space defined by
// `specs/overview.md` (origin top-left, x right, y down). That space is the
// engine's logical design size: the engine scales and letterboxes it onto the
// canvas, so no value here is ever expressed in real pixels and gameplay never
// leaves logical space. The pointer position the game reads is in these same
// units, so a hit test against a tile centre needs no conversion.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Meltdown fixes no palette, no
// font, no tower artwork, no glow curve, no panel layout and no animation. There
// is not a single color or type face in this file, and there is not meant to be
// one. `specs/overview.md` states what a player has to be able to READ at a
// glance — an emitter's heat along a ramp, a tripped tower apart from an online
// one, radiator faces apart from plain ones — and how the reactor looks is the
// build's to design. `BACKGROUND` is not here either: it is the build's own
// export from `src/game.ts`.
//
// EVERY RATE HERE IS PER SECOND. Meltdown mandates no fixed timestep: the engine
// hands the game the real elapsed seconds of each frame and imposes none of its
// own, and every rate below is integrated against that delta. `state.simTime`
// accumulates the game time the simulation advanced by, which is the frame's
// delta multiplied by the game speed.

// ---- Stage and panel (specs/overview.md, specs/floor.md) -----------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/**
 * The reactor region: the casing band and the tile grid inside it. The build
 * panel is the strip to its right, and the two together fill the stage.
 */
export const REACTOR_W = 986;
export const PANEL_X = 986;
export const PANEL_W = 294;

// ---- The floor (specs/floor.md) ------------------------------------------

/** The casing band's thickness, on all four sides. */
export const CASING = 18;

/** The tile grid: 50 x 36 tiles of 19 logical units each. */
export const TILE = 19;
export const COLS = 50;
export const ROWS = 36;

/** The floor's rectangle, inside the casing: the first tile's top-left corner. */
export const FLOOR_X0 = 18;
export const FLOOR_Y0 = 18;
export const FLOOR_W = 950;
export const FLOOR_H = 684;

/** The floor's far edge, one past the last tile. */
export const FLOOR_X1 = 968;
export const FLOOR_Y1 = 702;

/** The stage x of tile column `c`'s left edge. */
export const tileLeft = (c: number): number => FLOOR_X0 + c * TILE;

/** The stage y of tile row `r`'s top edge. */
export const tileTop = (r: number): number => FLOOR_Y0 + r * TILE;

/** The stage x of tile column `c`'s CENTRE. */
export const tileCX = (c: number): number => FLOOR_X0 + c * TILE + TILE / 2;

/** The stage y of tile row `r`'s CENTRE. */
export const tileCY = (r: number): number => FLOOR_Y0 + r * TILE + TILE / 2;

/** Whether `(c, r)` names a tile on the grid at all. */
export const inBounds = (c: number, r: number): boolean =>
  c >= 0 && c < COLS && r >= 0 && r < ROWS;

/**
 * The CENTRE of a `size` x `size` footprint anchored with its top-left tile at
 * `(col, row)`. Range is measured from this point, and it is the point a tower
 * reports as its own position.
 */
export const footprintCentre = (
  col: number,
  row: number,
  size: number,
): { x: number; y: number } => ({
  x: tileLeft(col) + (size * TILE) / 2,
  y: tileTop(row) + (size * TILE) / 2,
});

// ---- The openings (specs/floor.md) ---------------------------------------

/** The rows the left vent spans, inclusive. */
export const LEFT_VENT_ROWS = [16, 17, 18, 19] as const;

/** The rows the right exhaust spans, inclusive. */
export const RIGHT_EXHAUST_ROWS = [16, 17, 18, 19] as const;

/** The columns the top vent spans, inclusive. */
export const TOP_VENT_COLS = [22, 23, 24, 25, 26, 27, 28, 29] as const;

/** The columns the bottom exhaust spans, inclusive. */
export const BOTTOM_EXHAUST_COLS = [22, 23, 24, 25, 26, 27, 28, 29] as const;

/**
 * Each vent's FIXED opposite exhaust. A unit entering at a vent is assigned that
 * vent's opposite and never the nearer one.
 */
export const OPPOSITE = { left: "right", top: "bottom" } as const;

export type VentName = keyof typeof OPPOSITE;
export type ExhaustName = (typeof OPPOSITE)[VentName];

// ---- Heat (specs/heat.md) ------------------------------------------------

/** The heat an emitter trips at, and the top of the heat scale. */
export const TRIP_HEAT = 100;

/** The seconds a tripped emitter stays offline, bleeding linearly to zero. */
export const TRIP_TIME = 5.0;

/** Air cooling per radiator edge-tile per second, at full heat. */
export const RAD_K = 3.6;

/** Air cooling per plain edge-tile per second, at full heat. */
export const BASE_K = 1.1;

/** Conduction across a shared edge-tile, per degree of difference, per second. */
export const COND_K = 3.5;

/** The Forge's thermostat flow per shared edge-tile, per degree below setpoint. */
export const FORGE_K = 0.9;

/** The damage multiplier at heat 0 and from the redline up. */
export const MIN_HEAT_MULT = 0.35;
export const MAX_HEAT_MULT = 3.5;

/**
 * The damage curve: quadratic from `MIN_HEAT_MULT` at heat 0 to `MAX_HEAT_MULT`
 * at the tower's redline, then FLAT from the redline to 100, so heat above the
 * redline buys no damage and only brings the trip closer.
 */
export const heatMultiplier = (h: number, redline: number): number =>
  MIN_HEAT_MULT +
  (MAX_HEAT_MULT - MIN_HEAT_MULT) * Math.pow(Math.min(h, redline) / redline, 2);

// ---- The tower roster (specs/towers.md) ----------------------------------

/**
 * The eight towers, in SHOP ORDER. `arm1` .. `arm8` arm them in this order, so
 * `Digit1` arms the Arc and `Digit8` the Sink.
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

export interface MoverDef {
  readonly kind: "mover";
  readonly cost: number;
  readonly size: 2;
  /** A mover carries no heat, no radiator faces and no rotation. */
  readonly radiators: readonly [];
}

export type TowerDef = EmitterDef | MoverDef;

/**
 * The stat table, restated as prose in `specs/towers.md`. The Rime is an
 * ORDINARY EMITTER: base damage 4, redline 100, and a shot removes
 * `4 * heatMultiplier(H, 100)` exactly as every other emitter's does. Its slow is
 * an addition to that, not a replacement for it. Its redline sitting at the trip
 * means it never reaches a plateau and is at its weakest when cold, which is the
 * point of a tower whose slow is strongest cold.
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

/** What an upgrade does, applied once per level above I. */
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

// ---- The surge (specs/surge.md) ------------------------------------------

export const SURGE_TYPES = [
  "mote",
  "sprint",
  "hulk",
  "swarm",
  "drift",
  "core",
] as const;

export type SurgeType = (typeof SURGE_TYPES)[number];

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
 * and leak values are the same on wave 20 as on wave 1.
 */
export const hpScale = (w: number): number => 1 + 0.62 * (w - 1);

// ---- The run (specs/waves.md) --------------------------------------------

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

/** The count a wave 1 of each type would release, before growth. */
export const WAVE_BASE_COUNT: Readonly<Record<SurgeType, number>> = {
  mote: 12,
  sprint: 10,
  swarm: 24,
  drift: 8,
  hulk: 5,
  core: 1,
};

/** How much longer each wave is than wave 1, per wave. */
export const WAVE_GROWTH = 0.22;

/** The two waves of an `n`-wave run that are Core waves: the halfway one and the last. */
export const milestoneWaves = (n: number): readonly [number, number] => [
  Math.round(n / 2),
  n,
];

/** The single type wave `w` of an `n`-wave run carries. */
export const waveType = (w: number, n: number): SurgeType => {
  if (w === n || w === Math.round(n / 2)) return "core";
  if (w <= 8) return WAVE_OPENING[w - 1];
  return WAVE_CYCLE[(w - 9) % WAVE_CYCLE.length];
};

/** How many units wave `w` of an `n`-wave run releases. */
export const waveSize = (w: number, n: number): number => {
  const type = waveType(w, n);
  if (type === "core") return 1;
  return Math.ceil(WAVE_BASE_COUNT[type] * (1 + WAVE_GROWTH * (w - 1)));
};

// ---- The economy (specs/economy.md) --------------------------------------

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

// ---- Modes and difficulty (specs/modes.md) -------------------------------

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
export const BOTTLENECK_MONEY = 300;
export const SUDDEN_DEATH_MONEY = 300;

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
 * The derived-figures table. `waveCount`, `startMoney`, `startLives`, `interest`
 * and `buildZone` follow the mode and difficulty and nothing else, which is why
 * the debug surface has no setter for any of them.
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

// ---- Screen copy (specs/screens.md, specs/hud.md) ------------------------

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

/** The smallest side a panel control may be drawn at, in logical units. */
export const MIN_TOUCH_TARGET = 32;

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * The floor is built on with the pointer, so the keyboard moves a menu highlight
 * and nothing else: a four-way pad and the menu vocabulary that comes with it.
 * The thirteen actions Meltdown registers beyond that vocabulary sit outside the
 * layout, and every touch interaction is a tap on a panel control rather than a
 * virtual pad, which is why the layout carries no action buttons.
 */
export const LAYOUT = "dpad-4";

/** Every action Meltdown registers. */
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
 * The key each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character. NO KEY DRIVES TWO
 * ACTIONS, so nothing is ever double-fired: `back` is Escape alone and carries
 * the precedence rule `specs/controls.md` states, `sell` is `KeyS` and is not
 * also a movement key, and `send` is Space and is not also a confirm.
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

// ---- Audio cues (specs/audio.md) -----------------------------------------

/** The ten cue names, one per event. Define and play exactly these. */
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

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const MELTDOWN_DEBUG_VERSION = 1;
