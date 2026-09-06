// Deepcore — the figures this case's specification fixes. CASE-PROVIDED.
//
// Under an engine the same numbers reach a validator from `src/constants.ts`,
// which is SEEDED into the run: the case hands the build the module and the
// checks import it back. An engineless run seeds no `src/` at all — the build
// writes every module it has, including whichever one it chooses to name these
// figures in — so there is nothing for a check to import, and the values have to
// live on the validator's side of the line.
//
// So this file is that side. Every value below is stated by the seeded
// specification the build was given, under the name that specification uses, and
// nothing here is read from a build: a check that compared a build's own constant
// against itself would grade nothing. The pairing is deliberate — `GAS_KNOCKBACK`
// here is `specs/hazards.md`'s knockback speed, and a build that shoves the miner
// at some other speed fails the point rather than moving the target.
//
// The FORMULAS are here for the same reason as the figures. `specs/world.md`
// states the camera lead, `specs/character.md` the climb cap, `specs/hazards.md`
// the gas damage curve, each as an expression over named constants; a check that
// re-derived one in its own body would be a check whose target drifts file by
// file. They are transcriptions of the specification's own arithmetic and nothing
// more, and each names the file it is stated in.
//
// Positions are in the world units of the mine (`specs/world.md`), the stage's
// logical units are the same length, every rate is per second, and every duration
// is in seconds.

/* -------------------------------------------------------------------------- */
/* The stage (specs/overview.md)                                              */
/* -------------------------------------------------------------------------- */

/** The logical design size, 16:9. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The status bar occupies `y` in `[0, HUD_H]`, full width, always visible. */
export const HUD_H = 56;

/** The mine viewport: the stage below the status bar. */
export const VIEW_W = STAGE_W;
export const VIEW_H = STAGE_H - HUD_H; // 664

/* -------------------------------------------------------------------------- */
/* The tile grid (specs/world.md)                                             */
/* -------------------------------------------------------------------------- */

/** A cell is `TILE` units square, and `(col, row)` spans `[col*TILE, +TILE]`. */
export const TILE = 80;

export const WORLD_COLS = 32;
export const WORLD_W = WORLD_COLS * TILE; // 2560

/** Columns `1`–`30` are playable; `0` and `31` are the bedrock border. */
export const PLAYABLE_COL_MIN = 1;
export const PLAYABLE_COL_MAX = WORLD_COLS - 2; // 30

/** The deepest row at the Standard size. */
export const STANDARD_ROWS = 500;

/** How much depth one row is worth, in meters. */
export const METERS_PER_ROW = 5;

/** The world `y` of the surface ground line: the top of `row 1`. */
export const SURFACE_Y = TILE; // 80

/** The camp row. Nothing is drilled here and there is no ceiling above it. */
export const SURFACE_ROW = 0;

/** The column the Core tile sits at, in the Core chamber row. */
export const CORE_COL = 16;

/** The one cell of `row 1` generation leaves open: the way down out of the camp. */
export const CAVE_MOUTH_COL = 26;

/** The column the miner spawns standing on (specs/expedition.md). */
export const SPAWN_COL = 4;

/**
 * The depth in meters of a miner whose feet rest at world `y`.
 *
 * `max(0, (y - SURFACE_Y) / TILE * METERS_PER_ROW)`, so the top of `row r` is at
 * `METERS_PER_ROW * (r - 1)` meters and the camp reads `0`.
 */
export function depthMetersAt(feetY: number): number {
  return Math.max(0, ((feetY - SURFACE_Y) / TILE) * METERS_PER_ROW);
}

/* -------------------------------------------------------------------------- */
/* The camera (specs/world.md)                                                */
/* -------------------------------------------------------------------------- */

/** The full carried vertical lead, in world units. */
export const CAM_LEAD_MAX = 212;

/** Seconds of sustained travel that take the lead from `0` to full. */
export const CAM_LEAD_RAMP = 2;

/** How much faster the lead unwinds toward `0` than it builds away from it. */
export const CAM_UNWIND_MULT = 4;

/** Vertical speed at or below which the miner counts as still. */
export const CAM_STILL_SPEED = 40;

/** Units per second the lead moves at while it travels away from `0`. */
export const CAM_LEAD_RATE = CAM_LEAD_MAX / CAM_LEAD_RAMP; // 106

/** The lead the camera is heading for at a vertical velocity of `vy`. */
export function leadTargetFor(vy: number): number {
  if (Math.abs(vy) <= CAM_STILL_SPEED) return 0;
  return Math.sign(vy) * CAM_LEAD_MAX;
}

/**
 * The lead `seconds` of sustained travel at `vy` carries it to from `lead`.
 *
 * The specification's rule exactly: toward the target at `CAM_LEAD_RATE` while
 * the move takes the lead away from `0` and at `CAM_UNWIND_MULT` times that while
 * it takes it toward `0`, never overshooting the target within an update.
 */
export function leadAfter(lead: number, vy: number, seconds: number): number {
  const target = leadTargetFor(vy);
  if (target === lead) return lead;
  const toward = Math.abs(target) < Math.abs(lead) || lead * target < 0;
  const rate = CAM_LEAD_RATE * (toward ? CAM_UNWIND_MULT : 1);
  const step = rate * seconds;
  const gap = target - lead;
  return Math.abs(gap) <= step ? target : lead + Math.sign(gap) * step;
}

/* -------------------------------------------------------------------------- */
/* World size (specs/world.md)                                                */
/* -------------------------------------------------------------------------- */

export type WorldSize = "quick" | "standard" | "marathon";

export const WORLD_SIZES: readonly WorldSize[] = [
  "quick",
  "standard",
  "marathon",
];

/** The size a fresh expedition and a `reset` open at. */
export const DEFAULT_WORLD_SIZE: WorldSize = "standard";

export const WORLD_SIZE_SCALE: Readonly<Record<WorldSize, number>> = {
  quick: 0.5,
  standard: 1,
  marathon: 2,
};

/** The Core chamber's row: `round(STANDARD_ROWS * WORLD_SIZE_SCALE)`. */
export function coreRowFor(size: WorldSize): number {
  return Math.round(STANDARD_ROWS * WORLD_SIZE_SCALE[size]);
}

/** The Core's depth in meters, as `size-select` states it: 1250 / 2500 / 5000. */
export function coreDepthMetersFor(size: WorldSize): number {
  return coreRowFor(size) * METERS_PER_ROW;
}

/** `depthFraction(row) = (row - 1) / (coreRow - 1)`: `0` at row 1, `1` at the deepest. */
export function depthFraction(row: number, coreRow: number): number {
  return (row - 1) / (coreRow - 1);
}

/** The row whose depth fraction is `f`, at a mine of `coreRow` rows. */
export function rowAtFraction(f: number, coreRow: number): number {
  return Math.round(1 + f * (coreRow - 1));
}

/* -------------------------------------------------------------------------- */
/* The four bands (specs/world.md)                                            */
/* -------------------------------------------------------------------------- */

export type Band = "topsoil" | "rockbed" | "deepstone" | "coreshell";

export const BAND_ORDER: readonly Band[] = [
  "topsoil",
  "rockbed",
  "deepstone",
  "coreshell",
];

/** The health of every minable tile in the band. */
export const BAND_HEALTH: Readonly<Record<Band, number>> = {
  topsoil: 4,
  rockbed: 8,
  deepstone: 12,
  coreshell: 16,
};

/** The band index of a depth fraction: `min(3, floor(4 * f))`. */
export function bandIndexAt(f: number): number {
  return Math.min(3, Math.floor(4 * f));
}

/** The band a depth fraction falls in. */
export function bandAtFraction(f: number): Band {
  return BAND_ORDER[bandIndexAt(f)];
}

/** The depth fraction the rockbed opens at: gas and unbreakable stone begin here. */
export const ROCKBED_TOP_FRACTION = 0.25;

/** The depth fraction the deepstone opens at: lava begins here. */
export const DEEPSTONE_TOP_FRACTION = 0.5;

/* -------------------------------------------------------------------------- */
/* Generation (specs/world.md)                                                */
/* -------------------------------------------------------------------------- */

/** The share of minable cells that are ore veins, the same at every depth. */
export const ORE_DENSITY = 0.14;

/** The first row an ore vein may appear on: the first three rows are plain rock. */
export const ORE_MIN_ROW = 4;

/** Unbreakable stone's share, rising linearly across the rockbed and below. */
export const STONE_DENSITY_MIN = 0.02;
export const STONE_DENSITY_MAX = 0.08;

/** Gas pockets' share, rising linearly across the rockbed and below. */
export const GAS_DENSITY_MIN = 0.004;
export const GAS_DENSITY_MAX = 0.012;

/** Lava's share, rising linearly across the deepstone and below. */
export const LAVA_DENSITY_MIN = 0.03;
export const LAVA_DENSITY_MAX = 0.1;

/**
 * How far a measured share may sit from the stated one, relative to it, measured
 * over a whole band.
 */
export const DENSITY_TOLERANCE = 0.25;

/** A share rising linearly from `min` at fraction `from` to `max` at `1`. */
function rampedDensity(f: number, from: number, min: number, max: number) {
  if (f < from) return 0;
  return min + ((max - min) * (f - from)) / (1 - from);
}

/** Unbreakable stone's share at depth fraction `f`; `0` in the topsoil. */
export function stoneDensityAt(f: number): number {
  return rampedDensity(
    f,
    ROCKBED_TOP_FRACTION,
    STONE_DENSITY_MIN,
    STONE_DENSITY_MAX,
  );
}

/** Gas's share at depth fraction `f`; `0` in the topsoil. */
export function gasDensityAt(f: number): number {
  return rampedDensity(
    f,
    ROCKBED_TOP_FRACTION,
    GAS_DENSITY_MIN,
    GAS_DENSITY_MAX,
  );
}

/** Lava's share at depth fraction `f`; `0` above the deepstone. */
export function lavaDensityAt(f: number): number {
  return rampedDensity(
    f,
    DEEPSTONE_TOP_FRACTION,
    LAVA_DENSITY_MIN,
    LAVA_DENSITY_MAX,
  );
}

/* -------------------------------------------------------------------------- */
/* The surface camp (specs/world.md)                                          */
/* -------------------------------------------------------------------------- */

export type BuildingId =
  | "fuel-depot"
  | "ore-market"
  | "save-pad"
  | "upgrade-shop"
  | "supply-depot"
  | "launch-pad";

/** The six buildings that stand in the camp. Where they stand is the build's. */
export const BUILDING_IDS: readonly BuildingId[] = [
  "fuel-depot",
  "ore-market",
  "save-pad",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
];

/** The least clear ground between any two footprints, in world units. */
export const BUILDING_GAP = 40;

/* -------------------------------------------------------------------------- */
/* Tiles (specs/world.md)                                                     */
/* -------------------------------------------------------------------------- */

export type TileKind =
  | "rock"
  | "ore"
  | "material"
  | "gas"
  | "lava"
  | "stone"
  | "bedrock"
  | "tunnel"
  | "core";

export const TILE_KINDS: readonly TileKind[] = [
  "rock",
  "ore",
  "material",
  "gas",
  "lava",
  "stone",
  "bedrock",
  "tunnel",
  "core",
];

/** The kinds `setTile` accepts: ore and material cells have poses of their own. */
export const SETTABLE_TILE_KINDS: readonly TileKind[] = [
  "rock",
  "gas",
  "lava",
  "stone",
  "bedrock",
  "tunnel",
  "core",
];

/** The kinds that carry a health and fall to the drill. */
export const MINABLE_TILE_KINDS: readonly TileKind[] = [
  "rock",
  "ore",
  "material",
  "gas",
  "lava",
];

/* -------------------------------------------------------------------------- */
/* The prospector (specs/character.md)                                        */
/* -------------------------------------------------------------------------- */

/** The miner's axis-aligned box, narrow enough for a one-tile shaft. */
export const MINER_W = 56;
export const MINER_H = 72;

export const GRAVITY = 1500;
export const WALK_SPEED = 250;
export const FALL_TERMINAL_EMPTY = 950;
export const FALL_TERMINAL_LOADED = 1600;

/** The share of the empty climb cap that survives a full load. */
export const CLIMB_CAP_FLOOR = 0.58;

/** How long the hurt state holds from the blow. */
export const HURT_TIME = 0.4;

/** Terminal fall speed at load fraction `load`. */
export function fallTerminalAt(load: number): number {
  return (
    FALL_TERMINAL_EMPTY +
    (FALL_TERMINAL_LOADED - FALL_TERMINAL_EMPTY) * Math.min(1, load)
  );
}

/** The net upward acceleration thrust produces at load fraction `load`. */
export function climbAccelAt(emptyAccel: number, load: number): number {
  return emptyAccel * Math.max(0, 1 - load);
}

/** The upward speed cap at load fraction `load`. */
export function climbCapAt(emptyClimb: number, load: number): number {
  return emptyClimb * (1 - (1 - CLIMB_CAP_FLOOR) * Math.min(1, load));
}

/** The eight animation states, exactly one of which holds at a time. */
export type MinerState =
  | "idle"
  | "walk"
  | "drill-down"
  | "drill-side"
  | "jetpack"
  | "fall"
  | "hurt"
  | "fuel-out";

export const MINER_STATES: readonly MinerState[] = [
  "idle",
  "walk",
  "drill-down",
  "drill-side",
  "jetpack",
  "fall",
  "hurt",
  "fuel-out",
];

export type Facing = "east" | "west";

/* -------------------------------------------------------------------------- */
/* Drilling and fuel (specs/character.md)                                     */
/* -------------------------------------------------------------------------- */

export const DRILL_HIT_INTERVAL = 0.125;
export const DRILL_HIT_FUEL = 0.25;

export const THRUST_BURN_MAX = 5;
export const THRUST_BURN_MIN = 2;
export const CRUISE_SPEED = 900;
export const AIR_BURN = 2;
export const LIFE_SUPPORT_BURN = 0.4;

/** Only the thrust burn is scaled by the world size. */
export const THRUST_BURN_SIZE_MULT: Readonly<Record<WorldSize, number>> = {
  quick: 2,
  standard: 1,
  marathon: 0.67,
};

/** The unscaled thrust burn at an upward speed of `up`. */
export function thrustBurnAt(up: number): number {
  return (
    THRUST_BURN_MAX +
    (THRUST_BURN_MIN - THRUST_BURN_MAX) * Math.min(1, up / CRUISE_SPEED)
  );
}

/** How many hits break a cell of `health` at `damagePerHit`. */
export function drillHitsFor(health: number, damagePerHit: number): number {
  return Math.ceil(health / damagePerHit);
}

export const LOW_FUEL_FRACTION = 0.2;
export const LOW_HULL_FRACTION = 0.25;

/* -------------------------------------------------------------------------- */
/* Hazards (specs/hazards.md)                                                 */
/* -------------------------------------------------------------------------- */

export const GAS_DAMAGE_MIN = 60;
export const GAS_DAMAGE_MAX = 400;

/** The blast radius, in tiles, measured centre to centre. */
export const GAS_BLAST_TILES = 1.5;

/** The speed the blast shoves the miner away at. */
export const GAS_KNOCKBACK = 700;

/** Every visible pocket wisps within this many seconds. */
export const GAS_SEEP_PERIOD = 2;

/** The hull a detonation at depth fraction `f` deals inside the radius. */
export function gasDamageAt(f: number): number {
  return (
    GAS_DAMAGE_MIN +
    ((GAS_DAMAGE_MAX - GAS_DAMAGE_MIN) * Math.max(0, f - 0.25)) / 0.75
  );
}

export const LAVA_CONTACT_DPS = 32;
export const LAVA_DRILL_DEEPSTONE = 60;
export const LAVA_DRILL_CORESHELL = 100;

/** The lump for drilling through a lava cell, before the radiator, by band. */
export const LAVA_DRILL_DAMAGE: Readonly<Record<Band, number>> = {
  topsoil: 0,
  rockbed: 0,
  deepstone: LAVA_DRILL_DEEPSTONE,
  coreshell: LAVA_DRILL_CORESHELL,
};

export const IMPACT_SAFE_SPEED = 700;
export const IMPACT_DAMAGE_RATE = 0.1;

/** The hull a landing at downward speed `v` costs. */
export function impactDamageAt(v: number): number {
  return Math.max(0, v - IMPACT_SAFE_SPEED) * IMPACT_DAMAGE_RATE;
}

export const CORE_TIMER = 90;
export const CORE_BLAST_TILES = 3;

export const NOTICE_DELAY = 1.5;
export const NOTICE_FADE = 8;

export type Hazard = "gas" | "lava";

/* -------------------------------------------------------------------------- */
/* Ore and gemstones (specs/mining.md)                                        */
/* -------------------------------------------------------------------------- */

export type Ore =
  | "ferron"
  | "marlite"
  | "cuprite"
  | "argenite"
  | "cobaltine"
  | "voltite"
  | "halcite"
  | "pyronium"
  | "cindrite"
  | "adamite"
  | "verdite"
  | "roselite"
  | "aurite";

export interface OreDef {
  /** Credits one unit sells for at the Ore Market. */
  value: number;
  /** Kilograms one unit adds to the load. */
  weight: number;
  /** The depth fraction the curve peaks at. */
  peak: number;
  /** How far either side of the peak the curve reaches. */
  spread: number;
  /** The curve's height at its peak. */
  pick: number;
  /** Whether it is one of the three gemstones. */
  gemstone: boolean;
}

/** The ten ores and the three gemstones, in the order the specification lists them. */
export const ORES: Readonly<Record<Ore, OreDef>> = {
  ferron: {
    value: 28,
    weight: 10,
    peak: 0.01,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  marlite: {
    value: 46,
    weight: 14,
    peak: 0.08,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  cuprite: {
    value: 65,
    weight: 18,
    peak: 0.19,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  argenite: {
    value: 150,
    weight: 24,
    peak: 0.36,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  cobaltine: {
    value: 240,
    weight: 31,
    peak: 0.49,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  voltite: {
    value: 380,
    weight: 39,
    peak: 0.61,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  halcite: {
    value: 560,
    weight: 48,
    peak: 0.72,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  pyronium: {
    value: 820,
    weight: 58,
    peak: 0.87,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  cindrite: {
    value: 1250,
    weight: 70,
    peak: 0.94,
    spread: 0.34,
    pick: 1,
    gemstone: false,
  },
  adamite: {
    value: 1900,
    weight: 84,
    peak: 0.97,
    spread: 0.45,
    pick: 0.06,
    gemstone: false,
  },
  verdite: {
    value: 450,
    weight: 48,
    peak: 0.375,
    spread: 0.125,
    pick: 0.03,
    gemstone: true,
  },
  roselite: {
    value: 1140,
    weight: 78,
    peak: 0.625,
    spread: 0.125,
    pick: 0.03,
    gemstone: true,
  },
  aurite: {
    value: 2460,
    weight: 116,
    peak: 0.875,
    spread: 0.125,
    pick: 0.03,
    gemstone: true,
  },
};

/** Every ore and gemstone id, in the specification's order. */
export const ORE_IDS = Object.keys(ORES) as Ore[];

/** The ten mineral ores alone. */
export const MINERAL_ORE_IDS = ORE_IDS.filter((id) => !ORES[id].gemstone);

/** The three gemstones alone, one per band below the topsoil. */
export const GEMSTONE_IDS = ORE_IDS.filter((id) => ORES[id].gemstone);

/** An ore's draw weight at depth fraction `f`, as the specification states it. */
export function oreWeightAt(def: OreDef, f: number): number {
  return def.pick * Math.max(0, 1 - Math.abs(f - def.peak) / def.spread);
}

/* -------------------------------------------------------------------------- */
/* Exotic materials and the scanner (specs/mining.md)                         */
/* -------------------------------------------------------------------------- */

export type Material = "resonite" | "cryenite";

export const MATERIALS: readonly Material[] = ["resonite", "cryenite"];

/** The band each material's single node is generated in. */
export const MATERIAL_BAND: Readonly<Record<Material, Band>> = {
  resonite: "rockbed",
  cryenite: "deepstone",
};

/** The scanner's lock range in tiles, by tier. Tier 1 is no scanner at all. */
export const SCANNER_RANGE: readonly number[] = [0, 10, 32];

/* -------------------------------------------------------------------------- */
/* The economy (specs/expedition.md)                                            */
/* -------------------------------------------------------------------------- */

export const FUEL_PRICE = 1;
export const REPAIR_PRICE = 2;
export const FUEL_BUY_INCREMENT = 25;
export const REPAIR_BUY_INCREMENT = 25;

/* -------------------------------------------------------------------------- */
/* The upgrade tracks (specs/upgrades.md)                                     */
/* -------------------------------------------------------------------------- */

export type UpgradeTrack =
  "fuel" | "drill" | "cargo" | "hull" | "jetpack" | "radiator" | "scanner";

export const UPGRADE_TRACKS: readonly UpgradeTrack[] = [
  "fuel",
  "drill",
  "cargo",
  "hull",
  "jetpack",
  "radiator",
  "scanner",
];

/**
 * The shared price ladder, indexed by the tier being bought.
 *
 * `UPGRADE_PRICES[2]` is the `300` that takes a track from tier 1 to tier 2, so
 * index `0` and `1` are unreachable and stated as `0`.
 */
export const UPGRADE_PRICES: readonly number[] = [0, 0, 300, 750, 1900, 4100];

export const FUEL_TANK_MAX: readonly number[] = [100, 175, 275, 400, 550];
export const DRILL_DAMAGE: readonly number[] = [1, 1.5, 2.5, 3.5, 5];
export const CARGO_CAPACITY: readonly number[] = [15, 25, 40, 70, 120];
export const HULL_MAX: readonly number[] = [100, 150, 220, 320, 450];
export const JETPACK_LIFT_LIMIT: readonly number[] = [
  350, 1100, 2850, 7400, 12700,
];
export const JETPACK_EMPTY_CLIMB: readonly number[] = [
  950, 1010, 1080, 1150, 1230,
];
export const JETPACK_EMPTY_ACCEL: readonly number[] = [
  1200, 1270, 1350, 1440, 1540,
];
export const RADIATOR_EFFECTIVENESS: readonly number[] = [
  0, 0.25, 0.45, 0.65, 0.8,
];

/** The highest tier each track reaches: five, except the scanner's three. */
export const MAX_TIER: Readonly<Record<UpgradeTrack, number>> = {
  fuel: 5,
  drill: 5,
  cargo: 5,
  hull: 5,
  jetpack: 5,
  radiator: 5,
  scanner: 3,
};

/** What buying `tier` on `track` costs, or `null` where the track is maxed out. */
export function upgradePrice(track: UpgradeTrack, tier: number): number | null {
  if (tier < 2 || tier > MAX_TIER[track]) return null;
  return UPGRADE_PRICES[tier];
}

/* -------------------------------------------------------------------------- */
/* Field supplies (specs/items.md)                                            */
/* -------------------------------------------------------------------------- */

export type ItemId =
  | "dynamite"
  | "plastic-explosives"
  | "quantum-teleporter"
  | "matter-transmitter"
  | "nanobots"
  | "emergency-fuel";

/** The six supplies in hotkey order, `1` through `6`. */
export const ITEM_IDS: readonly ItemId[] = [
  "dynamite",
  "plastic-explosives",
  "quantum-teleporter",
  "matter-transmitter",
  "nanobots",
  "emergency-fuel",
];

export const ITEM_PRICES: Readonly<Record<ItemId, number>> = {
  dynamite: 300,
  "plastic-explosives": 1000,
  "quantum-teleporter": 1500,
  "matter-transmitter": 8000,
  nanobots: 4000,
  "emergency-fuel": 2000,
};

/** Dynamite clears the `3x3` block centred on the miner's cell. */
export const DYNAMITE_RADIUS = 1;

/** Plastic Explosives clear the `5x5` block. */
export const PLASTIC_RADIUS = 2;

export const NANOBOT_HULL = 20;
export const EMERGENCY_FUEL = 30;

/** The Quantum Teleporter's uniform draws, in tiles and units per second. */
export const QUANTUM_DROP_MIN_TILES = 1;
export const QUANTUM_DROP_MAX_TILES = 8;
export const QUANTUM_VEL_MIN = 150;
export const QUANTUM_VEL_MAX = 700;

/* -------------------------------------------------------------------------- */
/* The escape rocket (specs/rocket.md)                                        */
/* -------------------------------------------------------------------------- */

export type RocketComponentId =
  "hull-frame" | "fuel-cells" | "guidance" | "thruster" | "ignition";

export interface RocketComponentDef {
  id: RocketComponentId;
  credits: number;
  /** The satchel material it consumes, or `null` where it needs Credits alone. */
  material: Material | "core-sample" | null;
}

/** The five components, in the order the checklist builds them. */
export const ROCKET_COMPONENTS: readonly RocketComponentDef[] = [
  { id: "hull-frame", credits: 4000, material: null },
  { id: "fuel-cells", credits: 7500, material: null },
  { id: "guidance", credits: 3000, material: "resonite" },
  { id: "thruster", credits: 6000, material: "cryenite" },
  { id: "ignition", credits: 5000, material: "core-sample" },
];

export const ROCKET_COMPONENT_IDS = ROCKET_COMPONENTS.map((c) => c.id);

/** The sum of the five prices. */
export const ROCKET_TOTAL_CREDITS = 25500;

/* -------------------------------------------------------------------------- */
/* Screens, panels and menus (specs/ui.md)                                    */
/* -------------------------------------------------------------------------- */

export type Screen =
  | "title"
  | "mode-select"
  | "size-select"
  | "how-to-play"
  | "in-mine"
  | "paused"
  | "victory"
  | "game-over";

export const SCREENS: readonly Screen[] = [
  "title",
  "mode-select",
  "size-select",
  "how-to-play",
  "in-mine",
  "paused",
  "victory",
  "game-over",
];

export type Panel =
  | "fuel-depot"
  | "ore-market"
  | "upgrade-shop"
  | "supply-depot"
  | "launch-pad"
  | "inventory";

export const PANELS: readonly Panel[] = [
  "fuel-depot",
  "ore-market",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
  "inventory",
];

export type Mode = "standard" | "hardcore";

export const MODES: readonly Mode[] = ["standard", "hardcore"];

export type DeathCause = "fuel-out" | "hull-destroyed" | "core-detonation";

export const TITLE_TEXT = "DEEPCORE";

/** The main menu. `CONTINUE` is present, and leads, only while a save exists. */
export const TITLE_ITEMS = [
  "CONTINUE",
  "NEW EXPEDITION",
  "HOW TO PLAY",
] as const;

/** The main menu with no save banked: `TITLE_ITEMS` without its first entry. */
export const TITLE_ITEMS_NO_SAVE = TITLE_ITEMS.slice(1);
export const MODE_ITEMS = ["STANDARD", "HARDCORE", "BACK"] as const;
export const SIZE_ITEMS = ["QUICK", "STANDARD", "MARATHON", "BACK"] as const;

/** The How To Play screen's menu, in this order. */
export const HOW_TO_PLAY_ITEMS = ["BACK"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const VICTORY_ITEMS = ["PLAY AGAIN", "MENU"] as const;
export const GAME_OVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;
export const GAME_OVER_SAVE_ITEMS = ["CONTINUE FROM SAVE", "MENU"] as const;

/** The status bar's reading while the load fraction is `1` or more. */
export const OVERLOAD = "OVERLOAD";

/* -------------------------------------------------------------------------- */
/* Controls (specs/controls.md)                                               */
/* -------------------------------------------------------------------------- */

export type Action =
  | "left"
  | "right"
  | "down"
  | "up"
  | "activate"
  | "inventory"
  | "pause"
  | "mute"
  | "jettison"
  | "supply1"
  | "supply2"
  | "supply3"
  | "supply4"
  | "supply5"
  | "supply6";

/**
 * Each action and the `KeyboardEvent.code` values that drive it.
 *
 * Codes rather than characters, because a binding is a physical key rather than
 * a layout-dependent one — and because that is the vocabulary a check presses in.
 */
export const ACTIONS: Readonly<Record<Action, readonly string[]>> = {
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  down: ["KeyS", "ArrowDown"],
  up: ["KeyW", "ArrowUp", "Space"],
  activate: ["KeyE", "Enter"],
  inventory: ["KeyI"],
  pause: ["Escape", "KeyP"],
  mute: ["KeyM"],
  jettison: ["KeyJ"],
  supply1: ["Digit1"],
  supply2: ["Digit2"],
  supply3: ["Digit3"],
  supply4: ["Digit4"],
  supply5: ["Digit5"],
  supply6: ["Digit6"],
};

/** The key the runtime shows and hides the diagnostics overlay with. */
export const OVERLAY_TOGGLE_CODE = "Backquote";

/**
 * A key no action is bound to and the overlay does not answer.
 *
 * Used to arm a build's audio: a Web Audio context opens on the first real user
 * gesture, and a key with no binding is a gesture that changes nothing.
 */
export const UNBOUND_KEY = "KeyZ";

/* -------------------------------------------------------------------------- */
/* Produced assets (specs/assets.md)                                          */
/* -------------------------------------------------------------------------- */

/** The frame rate a miner cycle is played at, `ANIM_FPS`. */
export const ANIM_FPS = 12;

/** The square a miner frame is authored to fit within, `MINER_SPRITE`. */
export const MINER_SPRITE = 80;

/** The square a status-bar icon is authored at, `ICON_SIZE`. */
export const ICON_SIZE = 24;

/** How many interchangeable rock variants a band carries at least, `TILE_VARIANTS`. */
export const TILE_VARIANTS = 3;

/** How many frames the drill-damage overlay carries at least, `CRACK_FRAMES`. */
export const CRACK_FRAMES = 4;

/** How many variants unbreakable stone is produced in at least, `STONE_VARIANTS`. */
export const STONE_VARIANTS = 2;

/** How many frames the lava shimmer carries at least, `LAVA_FRAMES`. */
export const LAVA_FRAMES = 2;

/**
 * The fewest distinct drawings a produced cycle carries.
 *
 * `specs/assets.md`: "every produced cycle carries at least two distinct
 * drawings, so a cycle that repeats one picture is not a cycle".
 */
export const DRAWINGS_MIN = 2;

/**
 * The least the screen shake displaces the drawn world at its peak, in logical
 * units.
 *
 * `specs/assets.md`: "The jitter displaces the drawn world by at least
 * `SHAKE_MIN` (`2`) logical units at its peak".
 */
export const SHAKE_MIN = 2;

/**
 * How long after the event the drawn world is back where it started, in seconds.
 *
 * `specs/assets.md`: "the world is back where it started within `SHAKE_SETTLE`
 * (`3`) seconds of the event".
 */
export const SHAKE_SETTLE = 3;

/** The miner's animation states, and the frames `specs/assets.md` asks each for. */
export const MINER_CYCLES: Readonly<Record<string, number>> = {
  idle: 2,
  walk: 4,
  "drill-down": 3,
  "drill-side": 3,
  jetpack: 3,
  fall: 2,
  hurt: 2,
  "fuel-out": 2,
};

/** The four bands' rock, by the file-name stem `assets/tiles/<band>-<n>.png` gives. */
export const BAND_TILES: readonly Band[] = BAND_ORDER;

/** The six surface buildings, by the ids `specs/world.md` gives them. */
export const BUILDING_SPRITES: readonly string[] = BUILDING_IDS;

/** The rest of what `assets/surface/` holds. */
export const SURFACE_SPRITES: readonly string[] = [
  "cave-mouth",
  "ground",
  "sky",
];

/** The material sprites, the Core, and the Core Sample. */
export const MATERIAL_SPRITES: readonly (Material | "core" | "core-sample")[] =
  [...MATERIALS, "core", "core-sample"];

/** The status-bar icons `assets/icons/<name>.png` holds. */
export const ICON_SPRITES: readonly string[] = [
  "fuel",
  "hull",
  "cargo",
  "credits",
  "depth",
  ...MATERIALS,
];

/** How many assembly states the rocket is produced at: `stage0` through `stage5`. */
export const ROCKET_STAGES = ROCKET_COMPONENTS.length + 1;

/** The twelve produced particle systems, by the file names `specs/assets.md` gives. */
export const FX_SYSTEMS: readonly string[] = [
  "gas-seep",
  "drill-debris",
  "jetpack-exhaust",
  "ore-sparkle",
  "material-shimmer",
  "gas-explosion",
  "lava-embers",
  "impact-dust",
  "core-extract",
  "core-detonation",
  "launch-exhaust",
  "death-burst",
];

/** The thirteen produced sounds, by the file names `specs/assets.md` gives. */
export const AUDIO_FILES: readonly string[] = [
  "drill",
  "thrust",
  "ore-pickup",
  "material-chime",
  "gas-explosion",
  "lava-sizzle",
  "impact",
  "fabricate",
  "launch",
  "death",
  "alarm-fuel",
  "alarm-core",
  "music",
];

/* -------------------------------------------------------------------------- */
/* The showcase (specs/showcase.md)                                           */
/* -------------------------------------------------------------------------- */

/** The showcase's directory, at the root of the repository the build produced. */
export const SHOWCASE_DIR = "showcase";

/** "`showcase/showcase.md`, the description." */
export const SHOWCASE_DESCRIPTION = "showcase/showcase.md";

/** "`showcase/showcase.toml`, the carousel." */
export const SHOWCASE_CAROUSEL = "showcase/showcase.toml";

/** "The carousel holds two to four entries." */
export const SHOWCASE_MIN_ENTRIES = 2;
export const SHOWCASE_MAX_ENTRIES = 4;

/** "Every file the carousel names exists there, and each stays under 25 MiB." */
export const SHOWCASE_MAX_MEDIA_BYTES = 25 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* The debug surface (specs/instrumentation.md)                               */
/* -------------------------------------------------------------------------- */

/** The version the surface reports. */
export const DEEPCORE_DEBUG_VERSION = 1;

