// Deepcore — fixed tuning constants.
//
// Every value here is pinned by the specs and is authoritative; the game reads these
// rather than re-deriving numbers inline. Where a spec calls a value "fixed", it is
// exported here verbatim. Sources are cited per block:
//   specs/overview.md   — stage, coordinate system, palette
//   specs/world.md      — grid, bands, depth
//   specs/character.md  — movement, fuel, hull
//   specs/mining.md     — ore values/bands, cargo
//   specs/hazards.md    — gas, lava, core timer
//   specs/upgrades.md   — the five upgrade tracks
//   specs/rocket.md     — the five rocket components

import type {
  Band,
  Ore,
  Material,
  RocketComponentId,
  UpgradeTrack,
} from "./types";

// ---------------------------------------------------------------------------
// Stage & coordinate system (specs/overview.md)
// ---------------------------------------------------------------------------

/** Logical stage size (16:9). All game logic operates in this space. */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

/** The top status bar occupies y in [0, STATUS_BAR_HEIGHT]. */
export const STATUS_BAR_HEIGHT = 56;

/** The mine viewport is x in [0, 1280], y in [56, 720] → 1280 x 664. */
export const VIEWPORT_X = 0;
export const VIEWPORT_Y = STATUS_BAR_HEIGHT;
export const VIEWPORT_WIDTH = STAGE_WIDTH;
export const VIEWPORT_HEIGHT = STAGE_HEIGHT - STATUS_BAR_HEIGHT; // 664

// ---------------------------------------------------------------------------
// The tile grid & world (specs/world.md)
// ---------------------------------------------------------------------------

/** Every tile is 48 x 48 logical pixels. */
export const TILE_SIZE = 48;

/** 24 columns [0, 23]; columns 0 and 23 are the unminable bedrock border. */
export const WORLD_COLS = 24;
export const PLAYABLE_COL_MIN = 1;
export const PLAYABLE_COL_MAX = 22;

/**
 * Rows: row 0 is the surface; the mine extends to row 96, the Core chamber.
 * Playable minable rows are 1..95; row 96 is the Core chamber.
 */
export const SURFACE_ROW = 0;
export const PLAYABLE_ROW_MIN = 1;
export const PLAYABLE_ROW_MAX = 95;
export const CORE_ROW = 96;
export const WORLD_ROWS = CORE_ROW + 1; // rows 0..96 inclusive

/** The 24 x 48 = 1152 px grid is centered in the 1280-wide viewport (64 px each side). */
export const GRID_PIXEL_WIDTH = WORLD_COLS * TILE_SIZE; // 1152
export const GRID_MARGIN_X = (STAGE_WIDTH - GRID_PIXEL_WIDTH) / 2; // 64

/** Depth reported to the player: each row below the surface is 5 m. Core chamber = 480 m. */
export const METERS_PER_ROW = 5;
export const CORE_DEPTH_METERS = CORE_ROW * METERS_PER_ROW; // 480

// ---------------------------------------------------------------------------
// The four depth bands + Core chamber (specs/world.md)
// ---------------------------------------------------------------------------

export interface BandDef {
  readonly band: Band;
  /** Inclusive row range [min, max] this band covers. */
  readonly rowMin: number;
  readonly rowMax: number;
  /** Tile hardness 1..4 (divides into drill power to give drill time). */
  readonly hardness: 1 | 2 | 3 | 4;
  /** Rock fill color from the palette. */
  readonly fill: string;
  /** Whether gas pockets appear in this band. */
  readonly gas: boolean;
  /** Whether lava appears in this band. */
  readonly lava: boolean;
  /** The exotic material sourced from this band, if any. */
  readonly material: Material | null;
}

export const BANDS: Record<Band, BandDef> = {
  topsoil: {
    band: "topsoil",
    rowMin: 1,
    rowMax: 24,
    hardness: 1,
    fill: "#3a2c1f",
    gas: false,
    lava: false,
    material: null,
  },
  rockbed: {
    band: "rockbed",
    rowMin: 25,
    rowMax: 48,
    hardness: 2,
    fill: "#3a3d44",
    gas: true,
    lava: false,
    material: "resonite",
  },
  deepstone: {
    band: "deepstone",
    rowMin: 49,
    rowMax: 72,
    hardness: 3,
    fill: "#20242c",
    gas: true,
    lava: true,
    material: "cryenite",
  },
  coreshell: {
    band: "coreshell",
    rowMin: 73,
    rowMax: 95,
    hardness: 4,
    fill: "#3a1512",
    gas: true,
    lava: true, // dense lava
    material: null,
  },
};

/** Band lookup order by depth, for resolving which band a row belongs to. */
export const BAND_ORDER: readonly Band[] = [
  "topsoil",
  "rockbed",
  "deepstone",
  "coreshell",
];

// ---------------------------------------------------------------------------
// Palette (specs/overview.md)
// ---------------------------------------------------------------------------

export const PALETTE = {
  void: "#05070a",
  duskSky: "#1b2536",
  surfaceGround: "#2c2620",
  topsoilFill: "#3a2c1f",
  rockbedFill: "#3a3d44",
  deepstoneFill: "#20242c",
  coreshellFill: "#3a1512",
  coreGlow: "#ff6a2a",
  bedrock: "#0c0f14",
  tunnel: "#0a0d12",
  tunnelEdge: "#171b22",
  tileGrid: "#ffffff14",
  ferron: "#b8794a",
  cuprite: "#4fb0a0",
  argenite: "#cdd6e0",
  voltite: "#5a8cff",
  pyronium: "#ff8a3a",
  adamite: "#8affda",
  resonite: "#4ad0ff",
  cryenite: "#b98cff",
  coreSample: "#ff4a2a",
  gas: "#9ad24a",
  lava: "#ff5220",
  fuel: "#ffcf4a",
  hull: "#46d6e6",
  cargo: "#c48a52",
  credits: "#ffd23a",
  minerSuit: "#ffcf9a",
  jetpackFlame: "#ffa63a",
  alert: "#ff5a52",
  panel: "#141a20",
  textPrimary: "#e8eef5",
  textSecondary: "#93a2b2",
  textTertiary: "#5d6b7a",
} as const;

/** System monospace stack (no downloaded web font — must render identically offline). */
export const FONT_STACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// ---------------------------------------------------------------------------
// Movement (specs/character.md)
// ---------------------------------------------------------------------------

/** Walk / lateral speed (logical px/s). */
export const WALK_SPEED = 150;
/** Terminal falling speed (logical px/s). */
export const FALL_TERMINAL = 420;
/** Net climb speed at full jetpack hold (logical px/s). */
export const THRUST_CLIMB = 200;
/** Gravity (logical px/s^2). */
export const GRAVITY = 900;

// ---------------------------------------------------------------------------
// Fuel (specs/character.md)
// ---------------------------------------------------------------------------

/** Fuel burned while holding jetpack thrust (fuel/s). */
export const FUEL_THRUST_RATE = 9.0;
/** Fuel burned for lateral drift while airborne (fuel/s). */
export const FUEL_LATERAL_AIR_RATE = 2.0;
/** Passive life-support drain while underground (fuel/s). */
export const FUEL_LIFE_SUPPORT_RATE = 0.4;
/** Fuel spent per tile drilled. */
export const FUEL_PER_TILE = 1.0;
/** Low-fuel warning threshold (fraction of max). */
export const LOW_FUEL_FRACTION = 0.2;

// ---------------------------------------------------------------------------
// Hull (specs/character.md, specs/hazards.md)
// ---------------------------------------------------------------------------

/** Hull lost to a gas explosion (if adjacent). */
export const GAS_DAMAGE = 25;
/** Hull drained per second while in contact with lava. */
export const LAVA_DAMAGE_RATE = 20;
/** Low-hull warning threshold (fraction of max). */
export const LOW_HULL_FRACTION = 0.25;

/**
 * Fall impact: a landing above SAFE_FALL_SPEED deals impact damage scaled to the
 * excess speed. The threshold and scale are reference feel (specs/hazards.md gives the
 * rule, not exact numbers); tune in the sim.
 */
export const SAFE_FALL_SPEED = FALL_TERMINAL * 0.7; // reference threshold
export const FALL_IMPACT_SCALE = 0.12; // hull per (px/s) of excess speed — reference

// ---------------------------------------------------------------------------
// Fuel Depot pricing (specs/world.md, specs/flow.md, specs/character.md)
// ---------------------------------------------------------------------------
//
// Fuel and hull are NEVER free and never refill on their own: they are bought here with
// Credits, a running cost of every trip alongside upgrades and the rocket. Prices are
// kept modest so a sensible dig still nets Credits (drilling already costs 1 fuel/tile,
// specs/character.md) while a reckless, fuel-guzzling, damage-taking run can cost more to
// recover than it earned.

/** Credits per unit of fuel bought at the Fuel Depot. */
export const FUEL_COST_PER_UNIT = 1;
/** Credits per point of hull repaired at the Fuel Depot. */
export const REPAIR_COST_PER_POINT = 2;
/** The fixed amount the depot's "+N" buttons add per click (fuel units / hull points). */
export const DEPOT_INCREMENT = 25;

// ---------------------------------------------------------------------------
// The unstable Core Sample (specs/hazards.md)
// ---------------------------------------------------------------------------

/** Destabilization countdown (seconds) that starts when the Core Sample is extracted. */
export const CORE_TIMER_SECONDS = 90;

// ---------------------------------------------------------------------------
// Ore (specs/mining.md)
// ---------------------------------------------------------------------------

export interface OreDef {
  readonly ore: Ore;
  /** Credits per unit when sold. */
  readonly value: number;
  /** Bands this ore is found in. */
  readonly bands: readonly Band[];
  /** Palette color the vein reads as. */
  readonly color: string;
  /** True for rare ores (Adamite) that appear only as a rare glint. */
  readonly rare: boolean;
}

export const ORES: Record<Ore, OreDef> = {
  ferron: {
    ore: "ferron",
    value: 6,
    bands: ["topsoil", "rockbed"],
    color: PALETTE.ferron,
    rare: false,
  },
  cuprite: {
    ore: "cuprite",
    value: 14,
    bands: ["topsoil", "rockbed"],
    color: PALETTE.cuprite,
    rare: false,
  },
  argenite: {
    ore: "argenite",
    value: 30,
    bands: ["rockbed", "deepstone"],
    color: PALETTE.argenite,
    rare: false,
  },
  voltite: {
    ore: "voltite",
    value: 65,
    bands: ["deepstone", "coreshell"],
    color: PALETTE.voltite,
    rare: false,
  },
  pyronium: {
    ore: "pyronium",
    value: 140,
    bands: ["coreshell"],
    color: PALETTE.pyronium,
    rare: false,
  },
  adamite: {
    ore: "adamite",
    value: 300,
    bands: ["deepstone", "coreshell"],
    color: PALETTE.adamite,
    rare: true,
  },
};

// ---------------------------------------------------------------------------
// Exotic materials (specs/mining.md)
// ---------------------------------------------------------------------------

/** Minimum number of each buried material node guaranteed in its band. */
export const MIN_MATERIAL_NODES = 3;

export interface MaterialDef {
  readonly material: Material;
  /** The band its node is buried in, or null for the Core Sample (Core chamber). */
  readonly band: Band | null;
  readonly color: string;
  /** Whether the scanner points to it (never points at the Core Sample). */
  readonly scannable: boolean;
}

export const MATERIALS: Record<Material, MaterialDef> = {
  resonite: {
    material: "resonite",
    band: "rockbed",
    color: PALETTE.resonite,
    scannable: true,
  },
  cryenite: {
    material: "cryenite",
    band: "deepstone",
    color: PALETTE.cryenite,
    scannable: true,
  },
  "core-sample": {
    material: "core-sample",
    band: null,
    color: PALETTE.coreSample,
    scannable: false,
  },
};

// ---------------------------------------------------------------------------
// Upgrade tracks (specs/upgrades.md)
// ---------------------------------------------------------------------------

/**
 * Each track has five tiers; the player starts at tier 1 and buys the next in order.
 * `prices[i]` is the cost to reach tier i+1 (prices[0] is 0 = the starting tier).
 */
export interface UpgradeTrackDef {
  readonly track: UpgradeTrack;
  /** Per-tier prices; index 0 is the free starting tier. */
  readonly prices: readonly number[];
}

/** Fuel tank: sets max fuel. */
export const FUEL_TANK_MAX: readonly number[] = [100, 175, 275, 400, 550];
export const FUEL_TANK_PRICES: readonly number[] = [0, 220, 600, 1400, 3000];

/** Drill: sets power (1..5). */
export const DRILL_POWER: readonly number[] = [1, 2, 3, 4, 5];
export const DRILL_PRICES: readonly number[] = [0, 260, 700, 1600, 3200];
/**
 * Drill time (seconds/tile) indexed [tierIndex][hardnessIndex], hardness 1..4 → index
 * 0..3. Row order matches DRILL_POWER tiers 1..5.
 */
export const DRILL_TIME_BY_TIER: readonly (readonly number[])[] = [
  [0.5, 1.4, 3.2, 6.0], // tier 1, power 1
  [0.35, 0.7, 1.6, 3.0], // tier 2, power 2
  [0.28, 0.5, 0.9, 1.7], // tier 3, power 3
  [0.22, 0.4, 0.6, 0.9], // tier 4, power 4
  [0.18, 0.32, 0.45, 0.6], // tier 5, power 5
];

/** Cargo bay: sets capacity in ore units. */
export const CARGO_CAPACITY: readonly number[] = [15, 25, 40, 65, 100];
export const CARGO_PRICES: readonly number[] = [0, 200, 550, 1300, 2800];

/** Hull: sets max hull. */
export const HULL_MAX: readonly number[] = [100, 150, 220, 320, 450];
export const HULL_PRICES: readonly number[] = [0, 240, 640, 1500, 3100];

/** Scanner: sets range in tiles. */
export const SCANNER_RANGE: readonly number[] = [6, 12, 20, 32, 48];
export const SCANNER_PRICES: readonly number[] = [0, 180, 480, 1000, 2000];

/** Number of tiers per track. */
export const MAX_TIER = 5;

/** Grouped view of the five tracks for shop iteration. */
export const UPGRADE_TRACKS: Record<
  UpgradeTrack,
  {
    readonly prices: readonly number[];
    readonly values: readonly number[];
    readonly label: string;
    readonly unit: string;
  }
> = {
  fuel: {
    prices: FUEL_TANK_PRICES,
    values: FUEL_TANK_MAX,
    label: "Fuel Tank",
    unit: "max fuel",
  },
  drill: {
    prices: DRILL_PRICES,
    values: DRILL_POWER,
    label: "Drill",
    unit: "power",
  },
  cargo: {
    prices: CARGO_PRICES,
    values: CARGO_CAPACITY,
    label: "Cargo Bay",
    unit: "units",
  },
  hull: {
    prices: HULL_PRICES,
    values: HULL_MAX,
    label: "Hull",
    unit: "max hull",
  },
  scanner: {
    prices: SCANNER_PRICES,
    values: SCANNER_RANGE,
    label: "Scanner",
    unit: "tiles range",
  },
};

// ---------------------------------------------------------------------------
// The escape rocket (specs/rocket.md)
// ---------------------------------------------------------------------------

export interface RocketComponentDef {
  readonly id: RocketComponentId;
  /** Build order 1..5. */
  readonly order: number;
  readonly label: string;
  readonly credits: number;
  /** Exotic material consumed on fabrication, if any. */
  readonly material: Material | null;
}

export const ROCKET_COMPONENTS: readonly RocketComponentDef[] = [
  { id: "hull-frame", order: 1, label: "Hull Frame", credits: 800, material: null },
  { id: "fuel-cells", order: 2, label: "Fuel Cells", credits: 1500, material: null },
  {
    id: "guidance",
    order: 3,
    label: "Guidance Unit",
    credits: 600,
    material: "resonite",
  },
  {
    id: "thruster",
    order: 4,
    label: "Thruster Assembly",
    credits: 1200,
    material: "cryenite",
  },
  {
    id: "ignition",
    order: 5,
    label: "Ignition Core",
    credits: 1000,
    material: "core-sample",
  },
];

/** Total Credits across all five components (specs/rocket.md). */
export const ROCKET_TOTAL_CREDITS = ROCKET_COMPONENTS.reduce(
  (sum, c) => sum + c.credits,
  0,
); // 5100

// ---------------------------------------------------------------------------
// Simulation (specs/controls.md)
// ---------------------------------------------------------------------------

/** Fixed logic tick rate (Hz) — deterministic, framerate-independent. */
export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
