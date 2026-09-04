// Deepcore — the figures this case's specification fixes. CASE-PROVIDED.
//
// The same numbers also reach the build from `src/constants.ts`, which is SEEDED
// into a run of this engine: the case hands the build that module and tells it
// not to edit it. They are restated here rather than imported from there, because
// what a check holds a build to is the SPECIFICATION. A check that read its
// figures out of the build's own tree would compare the build against itself,
// which every build passes — including one whose figure is wrong. The pairing is
// deliberate: `GAS_BLAST_TILES` here is `specs/hazards.md`'s blast radius, and a
// build that reaches a different distance fails the point rather than moving the
// target with it.
//
// So this file is the validator's side of the line, and it is the ONE PLACE a
// figure is written. A suite imports the value it asserts from here rather than
// spelling a number of its own, so a figure appears once and every point that
// turns on it reads the same value.
//
// EVERY VALUE BELOW IS STATED BY THE SEEDED SPECIFICATION, under the name that
// specification gives it, and each section names the spec file it was transcribed
// from. NOTHING here is read off the reference implementation: a validator that
// enshrined a value the specs leave open would fail a build that satisfies every
// stated requirement, which is worse than no validator at all. Where the
// specification leaves a choice — the palette, the type, the camp's layout, where
// a panel's controls sit — this file holds no figure, because there is nothing to
// hold, and the build reports what it chose through the debug surface instead.
//
// TWO COORDINATE SPACES, both in the same logical units. The STAGE is the fixed
// `STAGE_W x STAGE_H` design field the engine scales and letterboxes onto the
// canvas. The WORLD is the mine, far wider and far deeper than that field, and
// the camera projects one into the other at a zoom of `1`, so a world unit and a
// logical unit are the same length (`specs/world.md`).
//
// EVERY RATE IS PER SECOND and every duration is in seconds.

/* -------------------------------------------------------------------------- */
/* The stage (specs/overview.md)                                              */
/* -------------------------------------------------------------------------- */

/** "The stage is `STAGE_W x STAGE_H` (`1280 x 720`, 16:9) logical units." */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The status bar occupies `y` in `[0, HUD_H]` (`0` to `56`), full width. */
export const HUD_H = 56;

/** The mine viewport: the stage below the status bar, `1280 x 664`. */
export const VIEW_W = 1280;
export const VIEW_H = 664;

/* -------------------------------------------------------------------------- */
/* The tile grid (specs/world.md)                                             */
/* -------------------------------------------------------------------------- */

/**
 * The side of a square tile, in world units.
 *
 * The cell `(col, row)` occupies `x` in `[col * TILE, col * TILE + TILE]` and
 * `y` in `[row * TILE, row * TILE + TILE]`.
 */
export const TILE = 80;

/** The grid's width in columns, and the world width that follows from it. */
export const WORLD_COLS = 32;
export const WORLD_W = WORLD_COLS * TILE; // 2560

/** Columns `1` through `30` are playable; `0` and `31` are the bedrock border. */
export const PLAYABLE_COL_MIN = 1;
export const PLAYABLE_COL_MAX = WORLD_COLS - 2; // 30

/**
 * The camp row.
 *
 * `specs/world.md`: "`Row 0` is the surface: open sky and camp ground, where the
 * buildings stand". A miner at or above it is on the surface, which is where
 * `specs/modes.md` says a restore puts the player back.
 */
export const SURFACE_ROW = 0;

/** The deepest row at the Standard world size. */
export const STANDARD_ROWS = 500;

/** Meters of depth one row is worth, as the depth readout reports it. */
export const METERS_PER_ROW = 5;

/** The world `y` of the surface ground line, the top of `row 1`. */
export const SURFACE_Y = TILE; // 80

/** The column the Core tile sits in, on the Core chamber row. */
export const CORE_COL = 16;

/** The one open cell of `row 1`: the way down out of the camp. */
export const CAVE_MOUTH_COL = 26;

/** The column the miner starts an expedition standing at (specs/expedition.md). */
export const SPAWN_COL = 4;

/* -------------------------------------------------------------------------- */
/* The camera (specs/world.md)                                                */
/* -------------------------------------------------------------------------- */

/** The full vertical lead a sustained climb or descent builds, in world units. */
export const CAM_LEAD_MAX = 212;

/** Seconds of sustained travel it takes to build that full lead. */
export const CAM_LEAD_RAMP = 2;

/** How much faster the lead unwinds toward `0` than it builds away from it. */
export const CAM_UNWIND_MULT = 4;

/** Vertical speed at or below which the miner counts as still, so lead decays. */
export const CAM_STILL_SPEED = 40;

/* -------------------------------------------------------------------------- */
/* World size (specs/world.md, specs/character.md)                            */
/* -------------------------------------------------------------------------- */

/** The three world sizes, in the order the size menu lists them. */
export const WORLD_SIZES = ["quick", "standard", "marathon"] as const;

export type WorldSize = (typeof WORLD_SIZES)[number];

/**
 * How deeply each size scales `STANDARD_ROWS`.
 *
 * `coreRow` is `round(STANDARD_ROWS * WORLD_SIZE_SCALE)`: `250`, `500`, `1000`,
 * which the size menu states as `1250`, `2500`, and `5000` meters.
 */
export const WORLD_SIZE_SCALE: Readonly<Record<WorldSize, number>> = {
  quick: 0.5,
  standard: 1,
  marathon: 2,
};

/**
 * The multiplier the size applies to the jetpack's thrust burn, and to nothing
 * else (specs/character.md). Only the thrust burn is scaled by the world size.
 */
export const THRUST_BURN_SIZE_MULT: Readonly<Record<WorldSize, number>> = {
  quick: 2,
  standard: 1,
  marathon: 0.67,
};

/* -------------------------------------------------------------------------- */
/* The four depth bands (specs/world.md)                                      */
/* -------------------------------------------------------------------------- */

/** The four bands, shallowest first. A band's index is its position here. */
export const BANDS = ["topsoil", "rockbed", "deepstone", "coreshell"] as const;

export type BandName = (typeof BANDS)[number];

/**
 * The health every minable cell of a band starts at.
 *
 * The drill removes its tier's damage per hit, so the hits to break a cell are
 * `ceil(BAND_HEALTH[band] / damagePerHit)` (specs/character.md).
 */
export const BAND_HEALTH: Readonly<Record<BandName, number>> = {
  topsoil: 4,
  rockbed: 8,
  deepstone: 12,
  coreshell: 16,
};

/**
 * The depth fraction the rockbed starts at, and the deepstone.
 *
 * `specs/world.md` divides the minable rows into four equal bands, so a band's
 * top is a quarter of the mine below the one before it. Gas and unbreakable
 * stone begin at the rockbed; lava begins at the deepstone.
 */
export const ROCKBED_TOP_FRACTION = 0.25;
export const DEEPSTONE_TOP_FRACTION = 0.5;

/**
 * How many hits break a cell of `health` at `damagePerHit`.
 *
 * `specs/character.md` and `specs/upgrades.md` both state it as
 * `ceil(BAND_HEALTH / damagePerHit)`, and the table `specs/upgrades.md` prints
 * beside the drill ladder is that arithmetic written out.
 */
export function drillHitsFor(health: number, damagePerHit: number): number {
  return Math.ceil(health / damagePerHit);
}

/* -------------------------------------------------------------------------- */
/* What generation places (specs/world.md)                                    */
/* -------------------------------------------------------------------------- */

/** The share of minable cells that hold an ore vein, the same at every depth. */
export const ORE_DENSITY = 0.14;

/** The shallowest row an ore vein appears in: the first three rows are plain rock. */
export const ORE_MIN_ROW = 4;

/** Unbreakable stone's share, from the top of the rockbed to the bottom. */
export const STONE_DENSITY_MIN = 0.02;
export const STONE_DENSITY_MAX = 0.08;

/** A gas pocket's share, over the same span. */
export const GAS_DENSITY_MIN = 0.004;
export const GAS_DENSITY_MAX = 0.012;

/** Lava's share, from the top of the deepstone to the bottom of the coreshell. */
export const LAVA_DENSITY_MIN = 0.03;
export const LAVA_DENSITY_MAX = 0.1;

/**
 * How far a measured share may sit from its stated value, relative to it,
 * measured over a whole band.
 */
export const DENSITY_TOLERANCE = 0.25;

/* -------------------------------------------------------------------------- */
/* Tile kinds (specs/world.md)                                                */
/* -------------------------------------------------------------------------- */

/** The nine kinds a cell may be, in the order the specification tabulates them. */
export const TILE_KINDS = [
  "bedrock",
  "rock",
  "ore",
  "material",
  "gas",
  "lava",
  "stone",
  "core",
  "tunnel",
] as const;

export type TileKind = (typeof TILE_KINDS)[number];

/**
 * The five kinds `specs/world.md`'s tile table marks minable: the kinds that
 * carry a health and fall to the drill.
 */
export const MINABLE_TILE_KINDS: readonly TileKind[] = [
  "rock",
  "ore",
  "material",
  "gas",
  "lava",
];

/* -------------------------------------------------------------------------- */
/* The surface camp (specs/world.md)                                          */
/* -------------------------------------------------------------------------- */

/**
 * The six buildings, by the id the specification gives each.
 *
 * WHERE they stand along the camp is the build's, subject to the ground line, the
 * playable columns, and `BUILDING_GAP`; the build reports each footprint through
 * the debug surface, so nothing here fixes a position.
 */
export const BUILDINGS = [
  "fuel-depot",
  "ore-market",
  "save-pad",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
] as const;

export type BuildingId = (typeof BUILDINGS)[number];

/** The least clear ground any two footprints are separated by, in world units. */
export const BUILDING_GAP = 40;

/* -------------------------------------------------------------------------- */
/* The prospector (specs/character.md)                                        */
/* -------------------------------------------------------------------------- */

/** The miner's axis-aligned box, narrow enough for a one-tile shaft. */
export const MINER_W = 56;
export const MINER_H = 72;

/** Downward acceleration in open space, in units per second squared. */
export const GRAVITY = 1500;

/** Walk and lateral drift speed, on the ground and in the air alike. */
export const WALK_SPEED = 250;

/** Terminal fall speed empty, and at the lift limit. */
export const FALL_TERMINAL_EMPTY = 950;
export const FALL_TERMINAL_LOADED = 1600;

/** The share of the empty climb cap a fully loaded jetpack still reaches. */
export const CLIMB_CAP_FLOOR = 0.58;

/** The two facings, following the last lateral input. */
export const FACINGS = ["east", "west"] as const;

export type Facing = (typeof FACINGS)[number];

/* -------------------------------------------------------------------------- */
/* Drilling (specs/character.md)                                              */
/* -------------------------------------------------------------------------- */

/** Seconds between drill hits while a cut runs. */
export const DRILL_HIT_INTERVAL = 0.125;

/** Fuel each drill hit spends. */
export const DRILL_HIT_FUEL = 0.25;

/* -------------------------------------------------------------------------- */
/* Fuel and hull (specs/character.md)                                         */
/* -------------------------------------------------------------------------- */

/** Thrust burn per second, at zero upward speed and at or above the cruise. */
export const THRUST_BURN_MAX = 5;
export const THRUST_BURN_MIN = 2;

/** The upward speed at which the eased thrust rate is reached. */
export const CRUISE_SPEED = 900;

/** Fuel per second spent drifting laterally in the air. */
export const AIR_BURN = 2;

/** Fuel per second spent being below the surface ground line. */
export const LIFE_SUPPORT_BURN = 0.4;

/** The fraction of maximum fuel below which fuel is low and the alarm plays. */
export const LOW_FUEL_FRACTION = 0.2;

/** The fraction of maximum hull below which hull is low. */
export const LOW_HULL_FRACTION = 0.25;

/** Seconds the hurt state holds from the blow that caused it. */
export const HURT_TIME = 0.4;

/* -------------------------------------------------------------------------- */
/* Animation states (specs/character.md)                                      */
/* -------------------------------------------------------------------------- */

/** The eight states the miner is in exactly one of at a time. */
export const MINER_STATES = [
  "idle",
  "walk",
  "drill-down",
  "drill-side",
  "jetpack",
  "fall",
  "hurt",
  "fuel-out",
] as const;

export type MinerState = (typeof MINER_STATES)[number];

/* -------------------------------------------------------------------------- */
/* Ore and gemstones (specs/mining.md)                                        */
/* -------------------------------------------------------------------------- */

/** The ten mineral ores' ids, shallowest peak first. */
export const ORE_IDS = [
  "ferron",
  "marlite",
  "cuprite",
  "argenite",
  "cobaltine",
  "voltite",
  "halcite",
  "pyronium",
  "cindrite",
  "adamite",
] as const;

/** The three gemstones' ids, shallowest band first. */
export const GEMSTONE_IDS = ["verdite", "roselite", "aurite"] as const;

/** The id of any one of the thirteen minerals a cargo bay holds. */
export type OreId = (typeof ORE_IDS)[number] | (typeof GEMSTONE_IDS)[number];

/**
 * One entry of the mineral table.
 *
 * `peak`, `spread`, and `pick` are the depth curve a vein's contents are drawn
 * from: at a cell's depth fraction `f` the entry's weight is
 * `pick * max(0, 1 - abs(f - peak) / spread)`, and the draw is taken over those
 * weights in proportion.
 */
export interface Mineral {
  /** The id the debug surface and the asset paths use: the name in lower case. */
  readonly id: OreId;
  /** The display name. */
  readonly name: string;
  /** What one unit sells for at the Ore Market, in Credits. */
  readonly value: number;
  /** What one unit weighs, in kilograms. */
  readonly weightKg: number;
  /** The depth fraction the entry is most likely at. */
  readonly peak: number;
  /** How far either side of that peak it reaches at all. */
  readonly spread: number;
  /** The height of the curve at its peak. */
  readonly pick: number;
}

/** The ten mineral ores, shallowest peak first. */
export const ORES: readonly Mineral[] = [
  {
    id: "ferron",
    name: "Ferron",
    value: 28,
    weightKg: 10,
    peak: 0.01,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "marlite",
    name: "Marlite",
    value: 46,
    weightKg: 14,
    peak: 0.08,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "cuprite",
    name: "Cuprite",
    value: 65,
    weightKg: 18,
    peak: 0.19,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "argenite",
    name: "Argenite",
    value: 150,
    weightKg: 24,
    peak: 0.36,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "cobaltine",
    name: "Cobaltine",
    value: 240,
    weightKg: 31,
    peak: 0.49,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "voltite",
    name: "Voltite",
    value: 380,
    weightKg: 39,
    peak: 0.61,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "halcite",
    name: "Halcite",
    value: 560,
    weightKg: 48,
    peak: 0.72,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "pyronium",
    name: "Pyronium",
    value: 820,
    weightKg: 58,
    peak: 0.87,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "cindrite",
    name: "Cindrite",
    value: 1250,
    weightKg: 70,
    peak: 0.94,
    spread: 0.34,
    pick: 1,
  },
  {
    id: "adamite",
    name: "Adamite",
    value: 1900,
    weightKg: 84,
    peak: 0.97,
    spread: 0.45,
    pick: 0.06,
  },
];

/**
 * The three gemstones, one per band below the topsoil.
 *
 * Each is drawn from the same curve as the ores, so it adds no density of its
 * own, and once collected it behaves exactly like an ore.
 */
export const GEMSTONES: readonly Mineral[] = [
  {
    id: "verdite",
    name: "Verdite",
    value: 450,
    weightKg: 48,
    peak: 0.375,
    spread: 0.125,
    pick: 0.03,
  },
  {
    id: "roselite",
    name: "Roselite",
    value: 1140,
    weightKg: 78,
    peak: 0.625,
    spread: 0.125,
    pick: 0.03,
  },
  {
    id: "aurite",
    name: "Aurite",
    value: 2460,
    weightKg: 116,
    peak: 0.875,
    spread: 0.125,
    pick: 0.03,
  },
];

/** The whole draw pool an ore vein's contents come from: the ores and the gems. */
export const MINERALS: readonly Mineral[] = [...ORES, ...GEMSTONES];

/* -------------------------------------------------------------------------- */
/* Exotic materials and the scanner (specs/mining.md)                         */
/* -------------------------------------------------------------------------- */

/** The two materials buried as single nodes, one per band, the scanner finds. */
export const MATERIALS = ["resonite", "cryenite"] as const;

export type MaterialId = (typeof MATERIALS)[number];

/** The band each material's single node is generated in. */
export const MATERIAL_BAND: Readonly<Record<MaterialId, BandName>> = {
  resonite: "rockbed",
  cryenite: "deepstone",
};

/* -------------------------------------------------------------------------- */
/* Hazards (specs/hazards.md)                                                 */
/* -------------------------------------------------------------------------- */

/** A gas detonation's hull damage, at depth fraction `0.25` and at `1`. */
export const GAS_DAMAGE_MIN = 60;
export const GAS_DAMAGE_MAX = 400;

/**
 * The depth fraction gas first appears at, and so the floor of its damage curve.
 *
 * `specs/hazards.md` names it in the table itself: `GAS_DAMAGE_MIN` is the
 * "damage where gas first appears, at depth fraction `0.25`".
 */
export const GAS_FLOOR_FRACTION = 0.25;

/**
 * The hull a detonation at depth fraction `f` deals inside the radius.
 *
 * `specs/hazards.md`'s own expression:
 * `GAS_DAMAGE_MIN + (GAS_DAMAGE_MAX - GAS_DAMAGE_MIN) * max(0, f - 0.25) / 0.75`.
 */
export function gasDamageAt(f: number): number {
  return (
    GAS_DAMAGE_MIN +
    ((GAS_DAMAGE_MAX - GAS_DAMAGE_MIN) * Math.max(0, f - GAS_FLOOR_FRACTION)) /
      (1 - GAS_FLOOR_FRACTION)
  );
}

/** The radius, in tiles, within which a detonation reaches the miner. */
export const GAS_BLAST_TILES = 1.5;

/** The speed a detonation shoves the miner away at, in units per second. */
export const GAS_KNOCKBACK = 700;

/** Seconds within which every on-screen gas pocket wisps at least once. */
export const GAS_SEEP_PERIOD = 2;

/** Hull drained per second of lava contact, before the radiator. */
export const LAVA_CONTACT_DPS = 32;

/** Hull burned by drilling through one lava cell, before the radiator. */
export const LAVA_DRILL_DEEPSTONE = 60;
export const LAVA_DRILL_CORESHELL = 100;

/** The landing speed below which a landing costs nothing. */
export const IMPACT_SAFE_SPEED = 700;

/** Hull per unit of downward speed above that safe speed. */
export const IMPACT_DAMAGE_RATE = 0.1;

/**
 * The hull a landing at downward speed `v` costs.
 *
 * `specs/hazards.md`'s own expression:
 * `max(0, v - IMPACT_SAFE_SPEED) * IMPACT_DAMAGE_RATE`.
 */
export function impactDamageAt(v: number): number {
  return Math.max(0, v - IMPACT_SAFE_SPEED) * IMPACT_DAMAGE_RATE;
}

/** Seconds a freshly extracted Core Sample holds before it detonates. */
export const CORE_TIMER = 90;

/** The radius, in tiles, a jettisoned Sample's detonation kills within. */
export const CORE_BLAST_TILES = 3;

/** Seconds between a first-time hazard hit and its notice card appearing. */
export const NOTICE_DELAY = 1.5;

/** Seconds the card stays up before it fades on its own. */
export const NOTICE_FADE = 8;

/** The two hazards that raise a one-time notice. */
export const NOTICE_HAZARDS = ["gas", "lava"] as const;

export type NoticeHazard = (typeof NOTICE_HAZARDS)[number];

/* -------------------------------------------------------------------------- */
/* The upgrade tracks (specs/upgrades.md)                                     */
/* -------------------------------------------------------------------------- */

/** The seven tracks the Upgrade Shop sells, in the order it lists them. */
export const TRACKS = [
  "fuel",
  "drill",
  "cargo",
  "hull",
  "jetpack",
  "radiator",
  "scanner",
] as const;

export type TrackName = (typeof TRACKS)[number];

/**
 * The shared price ladder, indexed by the tier being left: `UPGRADE_PRICES[0]`
 * buys tier `2`.
 *
 * `scanner` has two purchasable levels and takes the first two rungs; the other
 * six take all four.
 */
export const UPGRADE_PRICES: readonly number[] = [300, 750, 1900, 4100];

/** The highest tier each track reaches: five, except the scanner's three. */
export const MAX_TIER: Readonly<Record<TrackName, number>> = {
  fuel: 5,
  drill: 5,
  cargo: 5,
  hull: 5,
  jetpack: 5,
  radiator: 5,
  scanner: 3,
};

/** Maximum fuel, by fuel tier. Every ladder below is indexed by `tier - 1`. */
export const FUEL_TIERS: readonly number[] = [100, 175, 275, 400, 550];

/** The health one drill hit removes, by drill tier. May be fractional. */
export const DRILL_DAMAGE_TIERS: readonly number[] = [1, 1.5, 2.5, 3.5, 5];

/** Cargo capacity in ore slots, by cargo tier. */
export const CARGO_TIERS: readonly number[] = [15, 25, 40, 70, 120];

/** Maximum hull, by hull tier. */
export const HULL_TIERS: readonly number[] = [100, 150, 220, 320, 450];

/** One rung of the jetpack ladder. */
export interface JetpackTier {
  /** The heaviest load the jetpack still climbs with, in kilograms. */
  readonly liftLimitKg: number;
  /** The upward speed cap at zero load, in units per second. */
  readonly emptyClimb: number;
  /** The upward acceleration at zero load, in units per second squared. */
  readonly emptyAccel: number;
}

/** The jetpack ladder, by jetpack tier. */
export const JETPACK_TIERS: readonly JetpackTier[] = [
  { liftLimitKg: 350, emptyClimb: 950, emptyAccel: 1200 },
  { liftLimitKg: 1100, emptyClimb: 1010, emptyAccel: 1270 },
  { liftLimitKg: 2850, emptyClimb: 1080, emptyAccel: 1350 },
  { liftLimitKg: 7400, emptyClimb: 1150, emptyAccel: 1440 },
  { liftLimitKg: 12700, emptyClimb: 1230, emptyAccel: 1540 },
];

/** The fraction lava damage is reduced by, by radiator tier. */
export const RADIATOR_TIERS: readonly number[] = [0, 0.25, 0.45, 0.65, 0.8];

/**
 * The scanner's lock range in tiles, by scanner tier.
 *
 * Tier `1` is no scanner at all, so it carries `null` and nothing is ever shown.
 */
export const SCANNER_TIERS: readonly (number | null)[] = [null, 10, 32];

/* -------------------------------------------------------------------------- */
/* The escape rocket (specs/rocket.md)                                        */
/* -------------------------------------------------------------------------- */

/** The five components' ids, in the order the checklist builds them. */
export const ROCKET_COMPONENT_IDS = [
  "hull-frame",
  "fuel-cells",
  "guidance",
  "thruster",
  "ignition",
] as const;

export type ComponentId = (typeof ROCKET_COMPONENT_IDS)[number];

/** One of the five components. */
export interface RocketComponent {
  /** The id the checklist and the debug surface use. */
  readonly id: ComponentId;
  /** The display name. */
  readonly name: string;
  /** What fabricating it costs, in Credits. */
  readonly credits: number;
  /** The material it consumes from the satchel, or `null` for Credits alone. */
  readonly material: MaterialId | "core-sample" | null;
}

/** The five components, in build order. */
export const ROCKET_COMPONENTS: readonly RocketComponent[] = [
  { id: "hull-frame", name: "Hull Frame", credits: 4000, material: null },
  { id: "fuel-cells", name: "Fuel Cells", credits: 7500, material: null },
  {
    id: "guidance",
    name: "Guidance Unit",
    credits: 3000,
    material: "resonite",
  },
  {
    id: "thruster",
    name: "Thruster Assembly",
    credits: 6000,
    material: "cryenite",
  },
  {
    id: "ignition",
    name: "Ignition Core",
    credits: 5000,
    material: "core-sample",
  },
];

/** The sum of the five prices. */
export const ROCKET_TOTAL_CREDITS = 25500;

/* -------------------------------------------------------------------------- */
/* Field supplies (specs/items.md)                                            */
/* -------------------------------------------------------------------------- */

/** The six supplies' ids, in the order the hotkeys `1` through `6` select them. */
export const ITEM_IDS = [
  "dynamite",
  "plastic-explosives",
  "quantum-teleporter",
  "matter-transmitter",
  "nanobots",
  "emergency-fuel",
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

/** One of the six single-use supplies sold at the Supply Depot. */
export interface FieldSupply {
  /** The id the panel, the hotkey, and the debug surface use. */
  readonly id: ItemId;
  /** The display name. */
  readonly name: string;
  /** What one costs, in Credits. */
  readonly price: number;
}

/** The six supplies, in hotkey order. */
export const ITEMS: readonly FieldSupply[] = [
  { id: "dynamite", name: "Dynamite", price: 300 },
  { id: "plastic-explosives", name: "Plastic Explosives", price: 1000 },
  { id: "quantum-teleporter", name: "Quantum Teleporter", price: 1500 },
  { id: "matter-transmitter", name: "Matter Transmitter", price: 8000 },
  { id: "nanobots", name: "Regenerative Nanobots", price: 4000 },
  { id: "emergency-fuel", name: "Emergency Fuel", price: 2000 },
];

/** What each supply costs, keyed by its id: the `price` column of `ITEMS`. */
export const ITEM_PRICES: Readonly<Record<ItemId, number>> = Object.fromEntries(
  ITEMS.map((item) => [item.id, item.price]),
) as Record<ItemId, number>;

/** The radius in cells each explosive clears around the miner's own cell. */
export const DYNAMITE_RADIUS = 1;
export const PLASTIC_EXPLOSIVES_RADIUS = 2;

/** Hull the Regenerative Nanobots repair, capped at the maximum. */
export const NANOBOT_HULL = 20;

/** Fuel the Emergency Fuel adds, capped at the maximum. */
export const EMERGENCY_FUEL = 30;

/**
 * The Quantum Teleporter's two draws: a height above the camp ground in tiles
 * and a downward speed in units per second, both uniform over these inclusive
 * bounds. They are a live player action and are not reproducible from the seed.
 */
export const TELEPORT_HEIGHT_TILES_MIN = 1;
export const TELEPORT_HEIGHT_TILES_MAX = 8;
export const TELEPORT_SPEED_MIN = 150;
export const TELEPORT_SPEED_MAX = 700;

/* -------------------------------------------------------------------------- */
/* The economy (specs/expedition.md)                                          */
/* -------------------------------------------------------------------------- */

/** Credits one unit of fuel costs at the Fuel Depot. */
export const FUEL_PRICE = 1;

/** Credits one point of hull repair costs at the Fuel Depot. */
export const REPAIR_PRICE = 2;

/** The fixed increments the Fuel Depot panel offers beside its fill-to-full. */
export const FUEL_BUY_INCREMENT = 25;
export const REPAIR_BUY_INCREMENT = 25;

/* -------------------------------------------------------------------------- */
/* Modes and deaths (specs/modes.md)                                          */
/* -------------------------------------------------------------------------- */

/** The two modes an expedition is played in. */
export const MODES = ["standard", "hardcore"] as const;

export type Mode = (typeof MODES)[number];

/** The three ways an expedition ends at the Game Over screen. */
export const DEATH_CAUSES = [
  "fuel-out",
  "hull-destroyed",
  "core-detonation",
] as const;

export type DeathCause = (typeof DEATH_CAUSES)[number];

/* -------------------------------------------------------------------------- */
/* Screens and panels (specs/ui.md)                                           */
/* -------------------------------------------------------------------------- */

/** The eight screens the game is in exactly one of. */
export const SCREENS = [
  "title",
  "mode-select",
  "size-select",
  "how-to-play",
  "in-mine",
  "paused",
  "victory",
  "game-over",
] as const;

export type ScreenName = (typeof SCREENS)[number];

/**
 * The six overlay panels. Five open at their building; `inventory` opens
 * anywhere. The Save Pad has no panel, because activating it saves on the spot.
 */
export const PANELS = [
  "fuel-depot",
  "ore-market",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
  "inventory",
] as const;

export type PanelId = (typeof PANELS)[number];

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/ui.md)                                                  */
/* -------------------------------------------------------------------------- */
//
// The words are fixed; where they are drawn is the build's, and the build reports
// each item's hit region through the debug surface.

export const TITLE_TEXT = "DEEPCORE";

/**
 * The title menu, in this order. `CONTINUE` is present only while a save exists,
 * and it comes first when it is present.
 */
export const TITLE_ITEMS = [
  "CONTINUE",
  "NEW EXPEDITION",
  "HOW TO PLAY",
] as const;

/** The mode menu, in this order. */
/**
 * The main menu with no save banked: `TITLE_ITEMS` without its first entry.
 *
 * `specs/ui.md` fixes `CONTINUE` as present only while a save exists, and first
 * when present, so the menu a title with an empty slot carries is the rest of it.
 */
export const TITLE_ITEMS_NO_SAVE = TITLE_ITEMS.slice(1);

export const MODE_ITEMS = ["STANDARD", "HARDCORE", "BACK"] as const;

/** The world-size menu, in this order. */
export const SIZE_ITEMS = ["QUICK", "STANDARD", "MARATHON", "BACK"] as const;

/** The How To Play screen's single menu item. */
export const HOW_TO_PLAY_ITEMS = ["BACK"] as const;

/** The pause menu, in this order. */
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;

/** The Victory menu, in this order. */
export const VICTORY_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/** The Game Over menu in Standard while a save exists, in this order. */
export const GAME_OVER_SAVE_ITEMS = ["CONTINUE FROM SAVE", "MENU"] as const;

/** The Game Over menu otherwise, in this order. */
export const GAME_OVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/** The named controls the panels carry. */
export const SELL = "SELL";
export const FABRICATE = "FABRICATE";
export const LAUNCH = "LAUNCH";
export const USE = "USE";
export const JETTISON = "JETTISON";

/** The status bar's cargo reading while the load fraction is `1` or more. */
export const OVERLOAD = "OVERLOAD";

/* -------------------------------------------------------------------------- */
/* Produced assets (specs/assets.md)                                          */
/* -------------------------------------------------------------------------- */

/** Frames per second every miner cycle plays at. */
export const ANIM_FPS = 12;

/** The square the miner's frames are authored to fit within, in units. */
export const MINER_SPRITE = 80;

/** The square a status-bar icon is authored at, in units. */
export const ICON_SIZE = 24;

/** The fewest interchangeable rock variants produced per band. */
export const TILE_VARIANTS = 3;

/** The fewest frames the drill-damage crack overlay runs through. */
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
export const BAND_TILES: readonly BandName[] = BANDS;

/** The six surface buildings, by the ids `specs/world.md` gives them. */
export const BUILDING_SPRITES: readonly string[] = BUILDINGS;

/** The rest of what `assets/surface/` holds. */
export const SURFACE_SPRITES: readonly string[] = [
  "cave-mouth",
  "ground",
  "sky",
];

/** The material sprites, the Core, and the Core Sample. */
export const MATERIAL_SPRITES: readonly (
  MaterialId | "core" | "core-sample"
)[] = [...MATERIALS, "core", "core-sample"];

/** The ten ores and the three gemstones, whose overlays are named in lower case. */
export const MINERAL_SPRITES: readonly OreId[] = [...ORE_IDS, ...GEMSTONE_IDS];

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

/* -------------------------------------------------------------------------- */
/* Audio cues (specs/assets.md)                                               */
/* -------------------------------------------------------------------------- */

/** The thirteen cue names the build defines and plays. */
export const CUES = {
  drill: "drill",
  thrust: "thrust",
  orePickup: "ore-pickup",
  materialChime: "material-chime",
  gasExplosion: "gas-explosion",
  lavaSizzle: "lava-sizzle",
  impact: "impact",
  fabricate: "fabricate",
  launch: "launch",
  death: "death",
  alarmFuel: "alarm-fuel",
  alarmCore: "alarm-core",
  music: "music",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

/** The thirteen produced sounds, by the cue names `specs/assets.md` files them under. */
export const AUDIO_FILES: readonly string[] = Object.values(CUES);

/* -------------------------------------------------------------------------- */
/* Input actions (specs/controls.md)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every action the game is driven by, bound to the `KeyboardEvent.code` values
 * that drive it.
 *
 * Codes rather than characters, because a binding is a physical key rather than a
 * layout-dependent one. The miner is driven from the keyboard alone, so no touch
 * layout is selected and this table is the whole keyboard vocabulary; the pointer
 * and touch drive the menus, the panels, and the status bar directly.
 */
export const ACTIONS = {
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
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type ActionName = keyof typeof ACTIONS;

/** The action names alone, in the order above. */
export const ACTION_NAMES = Object.keys(ACTIONS) as readonly ActionName[];

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

/** The version the debug surface reports as `version`. */
export const DEEPCORE_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/* ---- What the specification leaves to the build -------------------------- */
//
// Read to drive the build or to locate what it drew, NEVER compared against a
// figure of this case's own. Everything above is a value the specification fixes,
// so a check may assert it; everything below is a value the specification hands
// to the build, so there is nothing for a check to assert and the project has to
// ask the build what it chose.
//
// Taken BY NAME, one binding at a time, so the list stays something a reader can
// count. It is deliberately short, and a list that grows is the signal that this
// project is drifting back toward grading the build against itself.
//
// `specs/overview.md` requires `src/game.ts` to export `BACKGROUND`, the stage
// background colour `src/main.ts` hands the engine as the colour the canvas is
// cleared to, and states that the palette is the build's own: "The seeded stub
// exports a placeholder; replace it with the color your build uses." So the case
// fixes no colour here. What it does fix is that "the letterbox bars around the
// stage carry the stage's background color", and the only way to read that claim
// is to ask the build which colour it picked and then check the bars against the
// answer.

export { BACKGROUND } from "../src/game";
