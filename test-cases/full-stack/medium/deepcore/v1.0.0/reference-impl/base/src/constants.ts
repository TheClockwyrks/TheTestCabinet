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
//   specs/upgrades.md   — the seven upgrade tracks
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

/**
 * Every tile is 80 x 80 logical pixels. The world (32 cols) is 2560 px wide — WIDER than
 * the 1280 viewport — so only ~16 columns are on screen at once and the camera scrolls
 * horizontally as well as vertically (specs/world.md). The movement/gravity px/s
 * constants below are scaled with this tile size so the *tiles-per-second* feel — and
 * every balance number derived in tiles/seconds/kg — is unchanged from the reference.
 */
export const TILE_SIZE = 80;

/** 32 columns [0, 31]; columns 0 and 31 are the unminable bedrock border. */
export const WORLD_COLS = 32;
export const PLAYABLE_COL_MIN = 1;
export const PLAYABLE_COL_MAX = 30;

/**
 * Rows: row 0 is the surface; the mine extends to row 96, the Core chamber.
 * Playable minable rows are 1..95; row 96 is the Core chamber.
 */
export const SURFACE_ROW = 0;
export const PLAYABLE_ROW_MIN = 1;
export const PLAYABLE_ROW_MAX = 95;
export const CORE_ROW = 96;
export const WORLD_ROWS = CORE_ROW + 1; // rows 0..96 inclusive

/**
 * The world is 32 x 80 = 2560 px wide — wider than the 1280 viewport — so it is NOT
 * centered/letterboxed: its left edge sits at world x 0 and the camera scrolls across it
 * horizontally (specs/world.md). GRID_MARGIN_X is kept (0) so world x = col*TILE_SIZE.
 */
export const GRID_PIXEL_WIDTH = WORLD_COLS * TILE_SIZE; // 2560
export const GRID_MARGIN_X = 0;
/** Horizontal camera range: [0, world width − viewport width]. */
export const MAX_CAMERA_X = GRID_PIXEL_WIDTH - VIEWPORT_WIDTH; // 1280

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

/** Walk / lateral speed (logical px/s). Scaled with the 80px tile (was 150 at 48px). */
export const WALK_SPEED = 250;
/**
 * Terminal falling speed (logical px/s). Set high enough that a fall keeps
 * accelerating over several tiles before it caps (terminal is reached at
 * ~4 tiles of free-fall), so landing speed — and thus fall impact
 * (specs/hazards.md) — actually distinguishes a short hop from a full-depth
 * plunge. Only caps *descent*; the climb is capped separately, per jetpack tier
 * (JETPACK_CLIMB, specs/upgrades.md). Scaled with the 80px tile (was 600 at 48px).
 */
export const FALL_TERMINAL = 1000;
/** Gravity (logical px/s^2). Scaled with the 80px tile (was 900 at 48px). */
export const GRAVITY = 1500;

// ---------------------------------------------------------------------------
// Weight & lift (specs/character.md, specs/mining.md)
// ---------------------------------------------------------------------------
//
// Ore has WEIGHT (each ore's `weightKg`, below). The miner's total mass is its own
// hull/suit/drill/jetpack (MINER_BASE_MASS) plus the weight of the ore in the bay. The
// jetpack pushes up with a fixed FORCE per tier (JETPACK_LIFT); the upward *acceleration*
// it achieves is that force divided by the loaded mass, so a heavy haul climbs slower —
// and once the load is heavy enough that the thrust acceleration no longer exceeds
// GRAVITY, the jetpack can only slow the descent, not climb (the Motherload "too heavy to
// take off" wall). This is what makes the jetpack and cargo tracks matter together, and
// why an overloaded miner must JETTISON ore (specs/character.md) to fly out.

/** The miner's own mass (suit + drill + jetpack), in the same kg units as ore weight. */
export const MINER_BASE_MASS = 200;

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

/**
 * Gas-explosion hull damage SCALES WITH DEPTH (specs/hazards.md): a rockbed pocket is a
 * survivable tax, but a coreshell pocket near the Core is near-lethal on a starting hull —
 * so the deep bands demand hull *and* radiator tiers. The raw (pre-radiator) damage is
 *   max(GAS_BASE_DAMAGE, GAS_BASE_DAMAGE + GAS_DAMAGE_PER_METER * (depthM - GAS_BASE_DEPTH_M))
 * then reduced by the radiator's effectiveness (RADIATOR_EFFECTIVENESS). Anchored so gas is
 * ~20 where it first appears (rockbed top, 125 m) and ~119 at the Core (480 m).
 */
export const GAS_BASE_DAMAGE = 20;
export const GAS_BASE_DEPTH_M = 125; // rockbed top, where gas first appears
export const GAS_DAMAGE_PER_METER = 0.28;
/** Hull drained per second while in contact with lava, before the radiator reduces it. */
export const LAVA_DAMAGE_RATE = 32;
/** Low-hull warning threshold (fraction of max). */
export const LOW_HULL_FRACTION = 0.25;

/**
 * Fall impact: a landing above SAFE_FALL_SPEED deals impact damage scaled to the
 * excess speed. The threshold and scale are reference feel (specs/hazards.md gives the
 * rule, not exact numbers); tune in the sim.
 *
 * The safe threshold is pinned to a *drop height* (SAFE_FALL_TILES) rather than a bare
 * fraction of terminal, so short, ordinary drops — stepping off a ledge, dropping down a
 * shaft you already carved — never chip the hull (specs/hazards.md). A miner in free-fall
 * clears this many tiles before it lands hard enough to hurt; only genuinely long plunges
 * exceed it, and feathering the jetpack over the last couple of tiles keeps a deep drop
 * under the line. A full terminal-velocity slam costs ~18 hull on the starting hull —
 * meaningful but survivable, and a rounding error to an upgraded hull (specs/upgrades.md).
 */
export const SAFE_FALL_TILES = 3; // free drop height (tiles) before impact damage begins
export const SAFE_FALL_SPEED = Math.sqrt(2 * GRAVITY * SAFE_FALL_TILES * TILE_SIZE); // ~848 px/s @80px tile
export const FALL_IMPACT_SCALE = 0.12; // hull per (px/s) of excess speed — scaled with the 80px tile

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
  /**
   * Weight per unit (kg) — the load the jetpack must lift (specs/character.md). Value rises
   * steeply with depth while weight rises only gently, so value-per-kg climbs with depth: a
   * shallow ore is barely worth hauling up, a deep one richly repays its weight. Cargo is
   * limited by TOTAL WEIGHT, not a unit count (specs/mining.md).
   */
  readonly weightKg: number;
  /** Bands this ore is found in. */
  readonly bands: readonly Band[];
  /** Palette color the vein reads as. */
  readonly color: string;
  /** True for rare ores (Adamite) that appear only as a rare glint. */
  readonly rare: boolean;
}

// Value floor is set so the cheapest ore buys a meaningful amount of fuel (Ferron 28 ≈ 28
// fuel, at 1 Credit/unit) — a dig nets a real surplus over its refuel cost, never a
// fuel-for-fuel treadmill. The curve is steep (28 → 1900, ~68×) but its ceiling stays far
// below Motherload's (there is no boss run to fund); value-per-kg runs 2.8 → 41 kg⁻¹.
export const ORES: Record<Ore, OreDef> = {
  ferron: {
    ore: "ferron",
    value: 28,
    weightKg: 10,
    bands: ["topsoil", "rockbed"],
    color: PALETTE.ferron,
    rare: false,
  },
  cuprite: {
    ore: "cuprite",
    value: 65,
    weightKg: 12,
    bands: ["topsoil", "rockbed"],
    color: PALETTE.cuprite,
    rare: false,
  },
  argenite: {
    ore: "argenite",
    value: 150,
    weightKg: 16,
    bands: ["rockbed", "deepstone"],
    color: PALETTE.argenite,
    rare: false,
  },
  voltite: {
    ore: "voltite",
    value: 380,
    weightKg: 24,
    bands: ["deepstone", "coreshell"],
    color: PALETTE.voltite,
    rare: false,
  },
  pyronium: {
    ore: "pyronium",
    value: 820,
    weightKg: 34,
    bands: ["coreshell"],
    color: PALETTE.pyronium,
    rare: false,
  },
  adamite: {
    ore: "adamite",
    value: 1900,
    weightKg: 46,
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

/**
 * Cargo bay: sets capacity as a TOTAL WEIGHT the bay holds, in kg (specs/mining.md). Ore
 * is limited by weight, not a unit count — a bay full of heavy deep ore holds far fewer
 * pieces than one of light shallow ore. Matched to the jetpack tiers so a full bay of the
 * same tier is liftable (JETPACK_LIFT); upgrading the bay ahead of the jetpack makes a full
 * haul un-liftable until the jetpack catches up (specs/character.md, specs/upgrades.md).
 */
export const CARGO_CAPACITY: readonly number[] = [180, 280, 420, 620, 900];
export const CARGO_PRICES: readonly number[] = [0, 200, 550, 1300, 2800];

/** Hull: sets max hull. */
export const HULL_MAX: readonly number[] = [100, 150, 220, 320, 450];
export const HULL_PRICES: readonly number[] = [0, 240, 640, 1500, 3100];

/** Scanner: sets range in tiles. */
export const SCANNER_RANGE: readonly number[] = [6, 12, 20, 32, 48];
export const SCANNER_PRICES: readonly number[] = [0, 180, 480, 1000, 2000];

/**
 * Jetpack (the engine track): sets both the lift FORCE and the empty-load climb SPEED CAP
 * (specs/upgrades.md, specs/character.md). JETPACK_LIFT is the upward acceleration the
 * jetpack achieves at the miner's base mass (MINER_BASE_MASS); loaded, the achieved
 * acceleration is JETPACK_LIFT * MINER_BASE_MASS / totalMass, so a heavier haul climbs
 * slower and, past a point, cannot climb at all. JETPACK_CLIMB caps the climb speed when
 * lightly loaded, so a better jetpack also simply climbs faster (less fuel per trip).
 *
 * The heaviest cargo a tier can still lift (thrust accel > gravity) is
 *   JETPACK_LIFT * MINER_BASE_MASS / GRAVITY - MINER_BASE_MASS
 * ≈ 256 / 378 / 533 / 733 / 956 kg for tiers 1..5 — each comfortably above the matching
 * cargo tier's kg cap (180/280/420/620/900), so matched gear lifts a full bay (slowly when
 * heavy); a bay upgraded ahead of the jetpack strands a full haul until the jetpack rises.
 */
// Scaled with the 80px tile (×5/3 from the 48px reference: LIFT and CLIMB are px/s²/px/s,
// but GRAVITY scaled by the same factor, so the heaviest-liftable load stays the same kg
// and the climb-speed cap stays the same tiles/s — matched cargo/jetpack balance unchanged).
export const JETPACK_LIFT: readonly number[] = [3417, 4333, 5500, 7000, 8667];
export const JETPACK_CLIMB: readonly number[] = [300, 350, 408, 475, 550];
export const JETPACK_PRICES: readonly number[] = [0, 240, 640, 1500, 3200];

/**
 * Radiator: reduces gas-explosion and lava-contact damage by its effectiveness fraction
 * (specs/upgrades.md, specs/hazards.md). Tier 1 is the bare stock plating (no reduction);
 * the deep bands' depth-scaled gas and dense lava make an upgraded radiator essential for
 * the core run. Effectiveness never reaches 100% — the deep is always dangerous.
 */
export const RADIATOR_EFFECTIVENESS: readonly number[] = [0, 0.25, 0.45, 0.65, 0.8];
export const RADIATOR_PRICES: readonly number[] = [0, 300, 700, 1500, 3000];

/** Number of tiers per track. */
export const MAX_TIER = 5;

/** Grouped view of the seven tracks for shop iteration. */
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
    unit: "kg",
  },
  hull: {
    prices: HULL_PRICES,
    values: HULL_MAX,
    label: "Hull",
    unit: "max hull",
  },
  jetpack: {
    prices: JETPACK_PRICES,
    values: JETPACK_CLIMB,
    label: "Jetpack",
    unit: "lift",
  },
  radiator: {
    prices: RADIATOR_PRICES,
    values: RADIATOR_EFFECTIVENESS,
    label: "Radiator",
    unit: "dmg cut",
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
