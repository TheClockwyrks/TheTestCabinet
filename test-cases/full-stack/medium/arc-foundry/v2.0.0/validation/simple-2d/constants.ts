// Arc Foundry — the figures this case's specification fixes, under the Simple 2D
// engine. CASE-PROVIDED.
//
// This is the validator's own side of the line, and it is the ONE PLACE a graded
// figure is written. A suite next door imports the value it asserts from here
// rather than spelling a number of its own, so a figure appears once and every
// point that turns on it reads the same value.
//
// WHY THESE FIGURES ARE WRITTEN HERE RATHER THAN IMPORTED FROM THE BUILD'S TREE.
// This engine's workspace seeds `src/constants.ts`, the same table under the same
// names for every build, and importing it back would spare this file its numbers.
// It would also make every bound a check asserts a value that travels with the
// tree under test: a build that moved a figure in the module it was told to leave
// alone would move the assertion with it, and every point resting on that figure
// would pass. The comparison would become "does the build do what the build says
// it does", which holds for every build, including one whose figure is wrong. So
// the numbers below are read off the SEEDED SPECIFICATION and stated here, on the
// case's side, and this file imports no FIGURE from the build at all: the one name
// it takes from the build's tree is the stage colour the specification leaves the
// build to choose, at the foot of the file. They are the same numbers this case's
// `validation/none/` project holds, which is what makes a score recorded under one
// engine comparable with a score recorded under another.
//
// EVERY VALUE BELOW IS STATED BY THE SEEDED SPECIFICATION, and each carries the
// spec file it came from. NOTHING here is read off the reference implementation: a
// check that enshrined a value the specs leave open would fail a build that
// satisfies every stated requirement, which is worse than no check at all. Where
// the specification leaves a choice — the palette, the fonts, the panel layout,
// the artwork, where a menu entry is drawn — this file holds no value, because
// there is nothing to hold.
//
// Every position is in the fixed 1280x720 logical-unit coordinate space of
// `specs/overview.md` (origin top-left, x right, y down), every rate is per
// second, every duration is in seconds, and a route length is in tiles.

/* -------------------------------------------------------------------------- */
/* The stage and its three regions (specs/overview.md)                        */
/* -------------------------------------------------------------------------- */

/** "a fixed stage of `STAGE_W x STAGE_H` (`1280 x 720`, 16:9)". */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The status bar: `x` `0`–`1280`, `y` `0`–`56`. */
export const BAR_H = 56;

/** The build panel: `x` `1000`–`1280`, `y` `56`–`720`. */
export const PANEL_X = 1000;
export const PANEL_W = 280;

/** The yard: `x` `0`–`1000`, `y` `56`–`720`. */
export const BOARD_X = 0;
export const BOARD_Y = 56;
export const BOARD_W = 1000;
export const BOARD_H = 664;

/* -------------------------------------------------------------------------- */
/* The tile grid (specs/yard.md)                                              */
/* -------------------------------------------------------------------------- */

/** One tile of the yard grid, by column and row. */
export interface Tile {
  readonly col: number;
  readonly row: number;
}

/** A rectangle of tiles, inclusive on all four bounds. */
export interface TileRect {
  readonly minCol: number;
  readonly maxCol: number;
  readonly minRow: number;
  readonly maxRow: number;
}

/**
 * "a grid of `GRID_COLS` (`50`) columns by `GRID_ROWS` (`33`) rows of `TILE`
 * (`20`) square tiles, anchored at the yard region's top-left corner `(0, 56)`".
 *
 * Tile `(c, r)`'s center is `(20c + 10, 56 + 20r + 10)`.
 */
export const GRID_COLS = 50;
export const GRID_ROWS = 33;
export const TILE = 20;

/**
 * "Every structure occupies a uniform footprint of `FOOTPRINT` (`2`) by
 * `FOOTPRINT` tiles ... anchored by its top-left tile". Legal anchors are `col`
 * `0`–`48` and `row` `0`–`31`, and a structure's center — the point range,
 * targeting and drawing are measured from — is `(20 * (col + 1), 56 + 20 * (row + 1))`.
 */
export const FOOTPRINT = 2;

/* -------------------------------------------------------------------------- */
/* The three maps (specs/yard.md)                                             */
/* -------------------------------------------------------------------------- */

/** The three map identifiers, in the order the map select lists them. */
export const MAP_IDS = ["substation", "switchyard", "transformer"] as const;

export type MapId = (typeof MAP_IDS)[number];

/**
 * One map: its display name, the edge tile the Load spills from, its six waypoint
 * anchors in chain order, the edge tile it grounds out at, and the fixed housings
 * it carries. Each waypoint coordinate is the ANCHOR of the four-tile platform
 * `specs/yard.md` defines; the arms and the stem follow from it.
 */
export interface FoundryMap {
  readonly id: MapId;
  readonly name: string;
  readonly entry: Tile;
  /** `WP1` through `WP6`, in chain order. */
  readonly waypoints: readonly Tile[];
  readonly collector: Tile;
  /** Fixed-blocked housings. Empty on a map that carries none. */
  readonly housings: readonly TileRect[];
}

/** The three maps and their exact coordinates, from `specs/yard.md`'s tables. */
export const MAPS: readonly FoundryMap[] = [
  {
    id: "substation",
    name: "The Substation",
    entry: { col: 0, row: 5 },
    waypoints: [
      { col: 44, row: 5 },
      { col: 44, row: 27 },
      { col: 5, row: 27 },
      { col: 5, row: 14 },
      { col: 36, row: 14 },
      { col: 36, row: 20 },
    ],
    collector: { col: 49, row: 20 },
    housings: [],
  },
  {
    id: "switchyard",
    name: "The Switchyard",
    entry: { col: 25, row: 0 },
    waypoints: [
      { col: 5, row: 26 },
      { col: 44, row: 6 },
      { col: 5, row: 6 },
      { col: 44, row: 26 },
      { col: 24, row: 16 },
      { col: 5, row: 16 },
    ],
    collector: { col: 25, row: 32 },
    housings: [],
  },
  {
    id: "transformer",
    name: "The Transformer Yard",
    entry: { col: 0, row: 2 },
    waypoints: [
      { col: 44, row: 5 },
      { col: 24, row: 16 },
      { col: 44, row: 28 },
      { col: 24, row: 28 },
      { col: 6, row: 28 },
      { col: 6, row: 16 },
    ],
    collector: { col: 0, row: 30 },
    housings: [
      { minCol: 12, maxCol: 19, minRow: 6, maxRow: 12 },
      { minCol: 30, maxCol: 37, minRow: 20, maxRow: 26 },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* The Load (specs/enemies.md)                                                */
/* -------------------------------------------------------------------------- */

/** The six roster types, in the order `specs/enemies.md` tables them. */
export const LOAD_TYPES = [
  "mote",
  "spark",
  "slug",
  "cluster",
  "filament",
  "dynamo",
] as const;

export type LoadType = (typeof LOAD_TYPES)[number];

/**
 * The finale's unit, distinct from the `dynamo` boss of the roster: the seventh
 * argument `spawnUnit` takes (`specs/instrumentation.md`).
 */
export const OVERLOAD_TYPE = "overload";

/**
 * Every argument `spawnUnit` takes: the six roster types and the finale's
 * Overload Dynamo (`OVERLOAD_TYPE`), in the order
 * `specs/instrumentation.md` lists them.
 */
export type SpawnType = LoadType | "overload";

/** One roster entry. Speeds are logical units per second. */
export interface LoadUnitType {
  readonly type: LoadType;
  readonly name: string;
  /** The base health the per-wave scaling multiplies. */
  readonly baseHealth: number;
  readonly speed: number;
  readonly flies: boolean;
  /** Charge paid the instant the unit dies. */
  readonly bounty: number;
  /** Grid Integrity lost when the unit grounds out. */
  readonly leak: number;
  readonly description: string;
}

/** The roster table of `specs/enemies.md`, in the order it lists. */
export const LOAD_ROSTER: readonly LoadUnitType[] = [
  {
    type: "mote",
    name: "Mote",
    baseHealth: 44,
    speed: 60,
    flies: false,
    bounty: 1,
    leak: 1,
    description: "The baseline charge unit.",
  },
  {
    type: "spark",
    name: "Spark",
    baseHealth: 27,
    speed: 120,
    flies: false,
    bounty: 1,
    leak: 1,
    description: "Roughly half a Mote's health at double its speed.",
  },
  {
    type: "slug",
    name: "Slug",
    baseHealth: 180,
    speed: 38,
    flies: false,
    bounty: 3,
    leak: 2,
    description:
      "A slow unit with a large health pool that costs 2 Grid Integrity on a leak.",
  },
  {
    type: "cluster",
    name: "Cluster",
    baseHealth: 16,
    speed: 72,
    flies: false,
    bounty: 1,
    leak: 1,
    description: "Very low health, released in tight packs.",
  },
  {
    type: "filament",
    name: "Filament",
    baseHealth: 74,
    speed: 85,
    flies: true,
    bounty: 2,
    leak: 1,
    description:
      "The flyer. It ignores the maze and flies the straight-line chain.",
  },
  {
    type: "dynamo",
    name: "Dynamo",
    baseHealth: 1500,
    speed: 30,
    flies: false,
    bounty: 40,
    leak: 5,
    description:
      "The boss. It reads as an unstable overload core and anchors the milestone waves.",
  },
];

/**
 * "It spawns at the entry and walks the chain to the collector exactly as any
 * ground unit does ... and at a speed of `55`."
 */
export const OVERLOAD_SPEED = 55;

/* -------------------------------------------------------------------------- */
/* Components (specs/components.md)                                           */
/* -------------------------------------------------------------------------- */

/** The eight base component identifiers. */
export const COMPONENT_TYPES = [
  "capacitor",
  "coil",
  "emitter",
  "arcnode",
  "discharge",
  "choke",
  "rectifier",
  "regulator",
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

/**
 * "Type | Uniform over the eight base types, `0.125` each. Refinement does not
 * change it." (`specs/scrap-press.md`).
 */
export const TYPE_ROLL_ODDS = 1 / COMPONENT_TYPES.length;

/** "Seven of the eight fire. The Regulator never fires". */
export const FIRING_COMPONENT_TYPES = [
  "capacitor",
  "coil",
  "emitter",
  "arcnode",
  "discharge",
  "choke",
  "rectifier",
] as const;

/** One rung of the five-rung quality ladder. `tier` is `1` through `5`. */
export interface QualityTier {
  readonly tier: number;
  readonly id: string;
  readonly name: string;
}

/** A quality tier, `1` (Scrap) through `5` (Tesla-Prime). */
export type Tier = 1 | 2 | 3 | 4 | 5;

/** The ladder of `specs/components.md`, in tier order. */
export const QUALITY_TIERS: readonly QualityTier[] = [
  { tier: 1, id: "scrap", name: "Scrap" },
  { tier: 2, id: "tuned", name: "Tuned" },
  { tier: 3, id: "charged", name: "Charged" },
  { tier: 4, id: "primed", name: "Primed" },
  { tier: 5, id: "teslaprime", name: "Tesla-Prime" },
];

/** The number of rungs. A tier is `1` through this value. */
export const MAX_QUALITY = 5;

/**
 * "Damage: `baseDamage * QUALITY_MULT[tier]`, where `QUALITY_MULT` is
 * `[1, 3, 9, 40, 110]`." Indexed by `tier - 1`.
 */
export const QUALITY_MULT: readonly number[] = [1, 3, 9, 40, 110];

/**
 * "Range: `baseRange + RANGE_PER_TIER * (tier - 1)`, where `RANGE_PER_TIER`
 * is `8`."
 */
export const RANGE_PER_TIER = 8;

/** "`TARGETING_PRIORITIES` holds the five", in the order the control cycles them. */
export const TARGETING_PRIORITIES = [
  "first",
  "last",
  "nearest",
  "strongest",
  "weakest",
] as const;

export type TargetingPriority = (typeof TARGETING_PRIORITIES)[number];

/** "every firing structure defaults to `first`". */
export const DEFAULT_TARGETING: TargetingPriority = "first";

/** "a projectile from its center at `PROJECTILE_SPEED` (`520`) units per second". */
export const PROJECTILE_SPEED = 520;

/**
 * "When the projectile comes within `PROJECTILE_HIT_R` (`6`) of that position it
 * applies its damage".
 */
export const PROJECTILE_HIT_R = 6;

/**
 * "the summed bonus is capped at `AURA_CAP` (`1.0`, doubling the structure's
 * damage)".
 */
export const AURA_CAP = 1.0;

/**
 * One type's Scrap-tier stats, which every higher tier scales from. The Regulator
 * neither fires nor reaches, so its range and fire rate are `null` and its reach
 * is `REGULATOR_AURA` instead.
 */
export interface BaseStats {
  readonly range: number | null;
  /** Shots per second. */
  readonly fireRate: number | null;
  readonly damage: number;
}

/** The base stats table of `specs/components.md`. */
export const BASE_STATS: Readonly<Record<ComponentType, BaseStats>> = {
  capacitor: { range: 100, fireRate: 1.6, damage: 6 },
  coil: { range: 110, fireRate: 1.0, damage: 5 },
  emitter: { range: 88, fireRate: 4.5, damage: 2 },
  arcnode: { range: 96, fireRate: 0.85, damage: 5 },
  discharge: { range: 160, fireRate: 0.5, damage: 18 },
  choke: { range: 104, fireRate: 1.3, damage: 3 },
  rectifier: { range: 96, fireRate: 1.1, damage: 2 },
  regulator: { range: null, fireRate: null, damage: 0 },
};

/* ---- The Coil's chain ---------------------------------------------------- */

/** "the nearest unit it has not already struck within `COIL_LEAP_RANGE` (`70`)". */
export const COIL_LEAP_RANGE = 70;

/** "Each leap deals `COIL_FALLOFF` (`0.7`) times the previous hit's damage". */
export const COIL_FALLOFF = 0.7;

/** "the maximum number of additional leaps by tier", indexed by `tier - 1`. */
export const COIL_LEAPS: readonly number[] = [2, 2, 3, 3, 4];

/* ---- The Arc-Node's splash ----------------------------------------------- */

/** "the radius by tier, `42` at Scrap and `5` more per tier". */
export const ARCNODE_SPLASH: readonly number[] = [42, 47, 52, 57, 62];

/* ---- The Choke's slow ---------------------------------------------------- */

/** "applies a slow for `CHOKE_SLOW_DUR` (`1.2`) seconds", flat at every tier. */
export const CHOKE_SLOW_DUR = 1.2;

/** "the amount by tier, `0.22 + 0.03 * (tier - 1)`". */
export const CHOKE_SLOW: readonly number[] = [0.22, 0.25, 0.28, 0.31, 0.34];

/* ---- The Rectifier's burn ------------------------------------------------ */

/** "a burn of `shotDamage * RECTIFIER_BURN_FRAC` (`0.5`) per second". */
export const RECTIFIER_BURN_FRAC = 0.5;

/** "for `RECTIFIER_BURN_DUR` (`2.0`) seconds", flat at every tier. */
export const RECTIFIER_BURN_DUR = 2.0;

/* ---- The Regulator's aura ------------------------------------------------ */

/** The Regulator's reach and the damage bonus it projects, at one tier. */
export interface AuraRung {
  readonly radius: number;
  readonly bonus: number;
}

/**
 * "the radius and bonus by tier, `radius = 90 + 6 * (tier - 1)` and
 * `bonus = 0.10 + 0.03 * (tier - 1)`", indexed by `tier - 1`.
 */
export const REGULATOR_AURA: readonly AuraRung[] = [
  { radius: 90, bonus: 0.1 },
  { radius: 96, bonus: 0.13 },
  { radius: 102, bonus: 0.16 },
  { radius: 108, bonus: 0.19 },
  { radius: 114, bonus: 0.22 },
];

/* -------------------------------------------------------------------------- */
/* Combination towers (specs/combinations.md)                                 */
/* -------------------------------------------------------------------------- */

/** The twelve tower identifiers, in the order `specs/combinations.md` lists them. */
export const COMBO_IDS = [
  "fusecluster",
  "staticweb",
  "slagdriver",
  "corroder",
  "ionprism",
  "forkarray",
  "nullcore",
  "rupturenode",
  "blightcoil",
  "reactorpile",
  "auroralance",
  "singularity",
] as const;

export type ComboId = (typeof COMBO_IDS)[number];

/**
 * "the four-rung track `0` through `COMBO_MAX_LEVEL` (`3`)". A tower lands at
 * level `0`.
 */
export const COMBO_MAX_LEVEL = 3;

/**
 * "Damage: `referenceDamage * COMBO_DAMAGE_MULT[level]`, where
 * `COMBO_DAMAGE_MULT` is `[0.5, 0.63, 0.78, 1.02]`."
 */
export const COMBO_DAMAGE_MULT: readonly number[] = [0.5, 0.63, 0.78, 1.02];

/**
 * "Range: `referenceRange + COMBO_RANGE_BONUS[level]`, where `COMBO_RANGE_BONUS`
 * is `[0, 4, 8, 12]`."
 */
export const COMBO_RANGE_BONUS: readonly number[] = [0, 4, 8, 12];

/**
 * The Charge cost of reaching a level, as a fraction of the tower's reference
 * damage, indexed by `level - 1`. "rounded to the nearest integer with an exact
 * half rounding up".
 */
export const COMBO_UPGRADE_COST_FRAC: readonly number[] = [0.8, 1.5, 2.8];

/** One ingredient of a recipe: a base type at an exact quality tier. */
export interface RecipeIngredient {
  readonly type: ComponentType;
  readonly tier: number;
}

/**
 * The abilities a tower carries, in the notation `specs/combinations.md` writes
 * them in: `splash(radius)`, `chain(leaps, leapRange, falloff)`,
 * `slow(amount, duration)`, `burn(fraction, duration)`,
 * `crit(chance, multiplier)`, `multishot(N)`, and `aura(radius, bonus)`. Each
 * behaves exactly as `specs/components.md` defines it, and every parameter is
 * flat across level.
 */
export interface ComboAbilities {
  /** Full damage to every unit within `radius` of the impact point. */
  readonly splash?: { readonly radius: number };
  /** `leaps` further hits, each within `leapRange`, each scaled by `falloff`. */
  readonly chain?: {
    readonly leaps: number;
    readonly leapRange: number;
    readonly falloff: number;
  };
  /** A slow of `amount` for `duration` seconds. */
  readonly slow?: { readonly amount: number; readonly duration: number };
  /** A burn of `shotDamage * fraction` per second for `duration` seconds. */
  readonly burn?: { readonly fraction: number; readonly duration: number };
  /** A `chance` of dealing `multiplier` times the shot's damage. */
  readonly crit?: { readonly chance: number; readonly multiplier: number };
  /** Fires at up to `targets` distinct in-range units each cadence. */
  readonly multishot?: { readonly targets: number };
  /** Buffs every firing structure within `radius` by `bonus`. */
  readonly aura?: { readonly radius: number; readonly bonus: number };
}

/**
 * One tower's reference block: "the figures a level-`3` tower scales toward". A
 * landed tower's live damage and range come from its level, through
 * `COMBO_DAMAGE_MULT` and `COMBO_RANGE_BONUS`.
 */
export interface Combo {
  readonly id: ComboId;
  readonly name: string;
  /** "an exact multiset of base `(type, tier)` ingredients". */
  readonly recipe: readonly RecipeIngredient[];
  readonly range: number;
  /** Shots per second. Flat across level. */
  readonly fireRate: number;
  readonly damage: number;
  readonly abilities: ComboAbilities;
  readonly description: string;
}

/** The twelve, from `specs/combinations.md`'s table and its descriptions. */
export const COMBOS: readonly Combo[] = [
  {
    id: "fusecluster",
    name: "Fuse Cluster",
    recipe: [
      { type: "regulator", tier: 1 },
      { type: "rectifier", tier: 1 },
      { type: "arcnode", tier: 1 },
    ],
    range: 108,
    fireRate: 1.0,
    damage: 40,
    abilities: {
      splash: { radius: 55 },
      burn: { fraction: 0.4, duration: 2.0 },
    },
    description: "A splash bolt that also burns what it hits.",
  },
  {
    id: "staticweb",
    name: "Static Web",
    recipe: [
      { type: "coil", tier: 1 },
      { type: "capacitor", tier: 1 },
      { type: "choke", tier: 1 },
    ],
    range: 120,
    fireRate: 1.2,
    damage: 34,
    abilities: {
      chain: { leaps: 3, leapRange: 80, falloff: 0.75 },
      slow: { amount: 0.25, duration: 1.2 },
    },
    description: "A chaining bolt that slows every unit it forks through.",
  },
  {
    id: "slagdriver",
    name: "Slag Driver",
    recipe: [
      { type: "discharge", tier: 2 },
      { type: "discharge", tier: 1 },
      { type: "emitter", tier: 1 },
    ],
    range: 175,
    fireRate: 0.6,
    damage: 120,
    abilities: { crit: { chance: 0.25, multiplier: 2.0 } },
    description: "A long-range heavy bolt that can land a critical hit.",
  },
  {
    id: "corroder",
    name: "Corroder",
    recipe: [
      { type: "rectifier", tier: 3 },
      { type: "regulator", tier: 3 },
      { type: "choke", tier: 2 },
    ],
    range: 110,
    fireRate: 1.1,
    damage: 40,
    abilities: {
      burn: { fraction: 0.6, duration: 3.0 },
      slow: { amount: 0.2, duration: 1.0 },
      aura: { radius: 80, bonus: 0.1 },
    },
    description:
      "Burns and slows what it hits, and projects a damage aura over nearby towers.",
  },
  {
    id: "ionprism",
    name: "Ion Prism",
    recipe: [
      { type: "discharge", tier: 3 },
      { type: "rectifier", tier: 4 },
      { type: "emitter", tier: 2 },
    ],
    range: 140,
    fireRate: 0.9,
    damage: 220,
    abilities: {
      splash: { radius: 50 },
      burn: { fraction: 0.5, duration: 2.0 },
      crit: { chance: 0.2, multiplier: 1.8 },
    },
    description: "A splash bolt that burns on impact and can crit.",
  },
  {
    id: "forkarray",
    name: "Fork Array",
    recipe: [
      { type: "emitter", tier: 3 },
      { type: "capacitor", tier: 3 },
      { type: "coil", tier: 2 },
    ],
    range: 118,
    fireRate: 1.8,
    damage: 100,
    abilities: { multishot: { targets: 3 } },
    description: "Fires at three separate targets at once.",
  },
  {
    id: "nullcore",
    name: "Null Core",
    recipe: [
      { type: "regulator", tier: 5 },
      { type: "capacitor", tier: 4 },
      { type: "arcnode", tier: 3 },
    ],
    range: 120,
    fireRate: 1.0,
    damage: 420,
    abilities: {
      splash: { radius: 55 },
      aura: { radius: 100, bonus: 0.2 },
    },
    description: "A splash core wrapped in a strong damage aura.",
  },
  {
    id: "rupturenode",
    name: "Rupture Node",
    recipe: [
      { type: "discharge", tier: 5 },
      { type: "arcnode", tier: 4 },
      { type: "emitter", tier: 3 },
    ],
    range: 150,
    fireRate: 0.7,
    damage: 1770,
    abilities: {
      splash: { radius: 60 },
      burn: { fraction: 0.5, duration: 2.0 },
    },
    description: "A heavy shot that detonates a large burning splash.",
  },
  {
    id: "blightcoil",
    name: "Blight Coil",
    recipe: [
      { type: "rectifier", tier: 5 },
      { type: "choke", tier: 4 },
      { type: "coil", tier: 2 },
    ],
    range: 128,
    fireRate: 1.1,
    damage: 375,
    abilities: {
      chain: { leaps: 3, leapRange: 80, falloff: 0.7 },
      burn: { fraction: 0.6, duration: 3.0 },
      slow: { amount: 0.3, duration: 1.5 },
    },
    description:
      "A chaining bolt that both slows and burns everything it forks through.",
  },
  {
    id: "reactorpile",
    name: "Reactor Pile",
    recipe: [
      { type: "coil", tier: 5 },
      { type: "choke", tier: 3 },
      { type: "regulator", tier: 2 },
    ],
    range: 130,
    fireRate: 1.4,
    damage: 420,
    abilities: {
      chain: { leaps: 4, leapRange: 85, falloff: 0.75 },
      multishot: { targets: 2 },
    },
    description: "Fires two heavy chain-lightning bolts at once.",
  },
  {
    id: "auroralance",
    name: "Aurora Lance",
    recipe: [
      { type: "choke", tier: 5 },
      { type: "coil", tier: 4 },
      { type: "discharge", tier: 4 },
    ],
    range: 190,
    fireRate: 0.7,
    damage: 1980,
    abilities: {
      chain: { leaps: 2, leapRange: 75, falloff: 0.6 },
      slow: { amount: 0.4, duration: 1.8 },
    },
    description:
      "Enormous reach and per-hit damage, a hard slow, and a chaining strike.",
  },
  {
    id: "singularity",
    name: "Singularity",
    recipe: [
      { type: "arcnode", tier: 5 },
      { type: "regulator", tier: 4 },
      { type: "rectifier", tier: 2 },
      { type: "arcnode", tier: 2 },
    ],
    range: 150,
    fireRate: 1.0,
    damage: 490,
    abilities: {
      splash: { radius: 65 },
      burn: { fraction: 0.6, duration: 2.5 },
      crit: { chance: 0.3, multiplier: 2.2 },
      aura: { radius: 90, bonus: 0.15 },
    },
    description: "Splash, burn, critical hits, and a damage aura in one tower.",
  },
];

/* -------------------------------------------------------------------------- */
/* The scrap-press (specs/scrap-press.md)                                     */
/* -------------------------------------------------------------------------- */

/**
 * "Each build phase grants `STAMPS_PER_LEVEL` (`5`) rock stamps." The allowance
 * is the same at every difficulty and unused stamps do not carry over.
 */
export const STAMPS_PER_LEVEL = 5;

/**
 * "the nine-rung track `R0` through `R8`, at `REFINEMENT_MAX` (`8`)". A run
 * starts at `R0`.
 */
export const REFINEMENT_MAX = 8;

/**
 * "`REFINEMENT_ODDS` holds one five-tier distribution per level, each summing to
 * `1`", indexed by `R`, each row running Scrap through Tesla-Prime.
 */
export const REFINEMENT_ODDS: readonly (readonly number[])[] = [
  [1.0, 0.0, 0.0, 0.0, 0.0],
  [0.7, 0.3, 0.0, 0.0, 0.0],
  [0.6, 0.3, 0.1, 0.0, 0.0],
  [0.5, 0.3, 0.2, 0.0, 0.0],
  [0.4, 0.3, 0.2, 0.1, 0.0],
  [0.3, 0.3, 0.3, 0.1, 0.0],
  [0.2, 0.3, 0.3, 0.2, 0.0],
  [0.1, 0.3, 0.3, 0.3, 0.0],
  [0.0, 0.3, 0.3, 0.3, 0.1],
];

/**
 * "`REFINEMENT_COSTS` holds the Charge cost of reaching each level from the one
 * below it", indexed by `R - 1`, so reaching `R1` costs `REFINEMENT_COSTS[0]`.
 */
export const REFINEMENT_COSTS: readonly number[] = [
  20, 50, 80, 110, 140, 170, 200, 230,
];

/* -------------------------------------------------------------------------- */
/* Charge and Grid Integrity (specs/economy.md, specs/hud.md)                 */
/* -------------------------------------------------------------------------- */

/** "The run opens with `START_CHARGE` (`10`) Charge." */
export const START_CHARGE = 10;

/** "The run opens with `START_INTEGRITY` (`20`) Grid Integrity." */
export const START_INTEGRITY = 20;

/**
 * "`WAVE_BONUS_BASE + WAVE_BONUS_STEP * waveNumber`, with `WAVE_BONUS_BASE` (`8`)
 * and `WAVE_BONUS_STEP` (`2`). Wave `1` therefore pays `10`."
 */
export const WAVE_BONUS_BASE = 8;
export const WAVE_BONUS_STEP = 2;

/**
 * "It reads as an alert once it falls to `5` or below" (`specs/hud.md`, the Grid
 * Integrity read).
 */
export const INTEGRITY_ALERT = 5;

/* -------------------------------------------------------------------------- */
/* Difficulty (specs/difficulty.md)                                           */
/* -------------------------------------------------------------------------- */

/** The three difficulty identifiers, in the order the select lists them. */
export const DIFFICULTY_IDS = ["easy", "medium", "hard"] as const;

export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

/**
 * One difficulty. `waves` is the run's `N`; the four scaling constants are the
 * only thing a difficulty changes about a unit, through
 *
 *   HP(w) = round( baseHP * baseMult * [ (1 + k * (w - 1)) + c * (r^(w - 1) - 1) ] )
 *
 * rounded to the nearest integer with an exact half rounding up. The milestone
 * waves are `round(waves / 2)` and `waves`.
 */
export interface Difficulty {
  readonly id: DifficultyId;
  readonly name: string;
  readonly waves: number;
  readonly baseMult: number;
  readonly k: number;
  readonly c: number;
  readonly r: number;
  readonly description: string;
}

/** The three, from `specs/difficulty.md`'s table and its shape-of-the-run column. */
export const DIFFICULTIES: readonly Difficulty[] = [
  {
    id: "easy",
    name: "Easy",
    waves: 40,
    baseMult: 0.2,
    k: 0.5,
    c: 0.08,
    r: 1.09,
    description:
      "The shortest run, with the lowest base health, the gentlest linear ramp, and the smallest late surcharge.",
  },
  {
    id: "medium",
    name: "Medium",
    waves: 50,
    baseMult: 0.22,
    k: 1.17,
    c: 0.28,
    r: 1.145,
    description:
      "The reference balance: a gentle opening and a steep late surcharge.",
  },
  {
    id: "hard",
    name: "Hard",
    waves: 60,
    baseMult: 0.24,
    k: 1.3,
    c: 0.22,
    r: 1.15,
    description:
      "The longest run, with the highest base health and the steepest late surcharge, so its final waves climb far past a Medium run's.",
  },
];

/* -------------------------------------------------------------------------- */
/* Screens and phases (specs/ui.md, specs/instrumentation.md)                 */
/* -------------------------------------------------------------------------- */

/** "The game is a state machine over eight screens." */
export const SCREENS = [
  "title",
  "mapselect",
  "difficultyselect",
  "howto",
  "playing",
  "paused",
  "victory",
  "overload",
] as const;

export type ScreenName = (typeof SCREENS)[number];

/** The three phases of a live run. Off the yard there is no phase. */
export const PHASES = ["build", "wave", "finale"] as const;

export type PhaseName = (typeof PHASES)[number];

/**
 * The four things that occupy the grid (`specs/scrap-press.md`), as the
 * snapshot's `kind` reports them (`specs/instrumentation.md`).
 */
export const STRUCTURE_KINDS = [
  "candidate",
  "component",
  "combo",
  "blocker",
] as const;

export type StructureKind = (typeof STRUCTURE_KINDS)[number];

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/ui.md, specs/hud.md)                                    */
/* -------------------------------------------------------------------------- */

export const TITLE_TEXT = "ARC FOUNDRY";
export const TAGLINE_TEXT = "GROUND THE LOAD";

/** "`SALVAGE`, `HOW TO PLAY`, in that order". */
export const TITLE_ITEMS = ["SALVAGE", "HOW TO PLAY"] as const;

/** "It offers `RESUME`, `RESTART`, and `QUIT TO MENU`." */
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;

/** "It offers `PLAY AGAIN` ... and `MENU`". */
export const VICTORY_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/** "It offers `TRY AGAIN` and `MENU`". */
export const OVERLOAD_ITEMS = ["TRY AGAIN", "MENU"] as const;

/** "A clear `PAUSED` read shows while the game is paused in place." */
export const PAUSED_TEXT = "PAUSED";

/** "An `OVERLOAD` read shows during the finale, with the Maze Rating accruing live." */
export const OVERLOAD_TEXT = "OVERLOAD";

/** "`WAVE n / N` ... and a `BUILD` read during a build phase." */
export const BUILD_TEXT = "BUILD";

/** "The press control: `STAMP`, showing that placement is free". */
export const STAMP_TEXT = "STAMP";

/**
 * The build panel's harvest prompt: "It reads `KEEP OR COMBINE A ROLL TO SEND`
 * during a build phase after wave `1`, and `KEEP OR COMBINE A ROLL TO START`
 * before wave `1`" (`specs/hud.md`).
 */
export const HARVEST_PROMPT_START = "KEEP OR COMBINE A ROLL TO START";
export const HARVEST_PROMPT_SEND = "KEEP OR COMBINE A ROLL TO SEND";

/* -------------------------------------------------------------------------- */
/* The readings' vocabularies (specs/instrumentation.md, specs/hud.md)        */
/* -------------------------------------------------------------------------- */

/** Every `action` a `panelButtons` row may carry, in the fixed slot order. */
export const PANEL_ACTIONS = [
  "keep",
  "downgrade",
  "combine",
  "combine-special",
  "upgrade",
  "targeting",
  "dismantle",
] as const;

export type PanelAction = (typeof PANEL_ACTIONS)[number];

/** Every `action` `statusControls` reports, in the order they are drawn. */
export const STATUS_CONTROLS = [
  "combos",
  "damage",
  "speed",
  "pause",
  "mute",
] as const;

export type StatusControl = (typeof STATUS_CONTROLS)[number];

/**
 * Every `readout` `statusReadouts` reports, in the order `specs/hud.md` draws
 * them left to right.
 *
 * These are the bar's READS rather than its controls: `specs/hud.md` gives the bar
 * "Charge", "Grid Integrity", "Wave" and "Maze length" in that order, and adds two
 * conditional reads — a `PAUSED` read "while the game is paused in place" and an
 * `OVERLOAD` read "during the finale". `specs/instrumentation.md` has the surface
 * report each one's rectangle, because the maze-length hover of
 * `specs/controls.md` acts on a read that no control reading carries.
 */
export const STATUS_READOUTS = [
  "charge",
  "integrity",
  "wave",
  "maze-length",
  "paused",
  "overload",
] as const;

export type StatusReadoutName = (typeof STATUS_READOUTS)[number];

/**
 * The three states every ingredient of every recipe is drawn in, "told apart at a
 * glance" (`specs/hud.md`), as `recipeEntries` reports them.
 */
export const INGREDIENT_STATES = ["selected", "owned", "missing"] as const;

export type IngredientState = (typeof INGREDIENT_STATES)[number];

/**
 * Every `action` a `pressControls` row may carry, in the order the panel draws
 * them.
 *
 * They are the build panel's own two controls rather than inspector actions: the
 * refinement control refines the press whatever is selected, and the press
 * control pulls the press. Neither appears in `PANEL_ACTIONS`.
 */
export const PRESS_CONTROLS = ["refine", "stamp"] as const;

export type PressControl = (typeof PRESS_CONTROLS)[number];

/** Every `action` a `menuButtons` row may carry. */
export const MENU_ACTIONS = [
  "salvage",
  "howto",
  "map-substation",
  "map-switchyard",
  "map-transformer",
  "difficulty-easy",
  "difficulty-medium",
  "difficulty-hard",
  "back",
  "resume",
  "restart",
  "quit",
  "again",
  "menu",
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

/* -------------------------------------------------------------------------- */
/* Input (specs/controls.md)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * "The engine is stood up with the `LAYOUT` (`single-vertical`) touch layout, one
 * vertical list, which is the shape every menu of `specs/ui.md` takes."
 *
 * The specification names the layout, so it is a figure rather than a choice: a
 * build that registered another layout speaks a vocabulary the menus were not
 * specified over, and fails the point that reads it.
 */
export const LAYOUT = "single-vertical";

/** The eighteen actions `specs/controls.md` tables, in the order it tables them. */
export const ACTIONS = [
  "stamp",
  "keep",
  "downgrade",
  "combine",
  "upgrade",
  "targeting",
  "dismantle",
  "speed",
  "pause",
  "pause-menu",
  "combos",
  "damage",
  "mute",
  "modify",
  "up",
  "down",
  "confirm",
  "back",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The key each action is bound to, from the same table, as a
 * `KeyboardEvent.code`. "Every action but `modify` is read as a press edge, so
 * holding its key fires it once. `modify` is read as a level instead".
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  stamp: ["KeyB"],
  keep: ["KeyK"],
  downgrade: ["KeyG"],
  combine: ["KeyC"],
  upgrade: ["KeyU"],
  targeting: ["KeyT"],
  dismantle: ["KeyX"],
  speed: ["KeyF"],
  pause: ["Space"],
  "pause-menu": ["Escape", "KeyP"],
  combos: ["KeyV"],
  damage: ["KeyL"],
  mute: ["KeyM"],
  modify: ["ShiftLeft", "ShiftRight"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  confirm: ["Enter"],
  back: ["Escape"],
};

/**
 * "The speed control cycles the multiplier through `1`, `2`, `4`, `8`, and back
 * to `1`, one step per activation."
 */
export const SPEEDS = [1, 2, 4, 8] as const;

/* -------------------------------------------------------------------------- */
/* Audio cues (specs/ui.md)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * "Define exactly the twelve cues in `CUES` ... and play them by name from
 * `update`, under exactly these names, one per event."
 */
export const CUES = {
  stamp: "stamp",
  fireBolt: "fire-bolt",
  fireSpark: "fire-spark",
  fireChain: "fire-chain",
  fireDischarge: "fire-discharge",
  combine: "combine",
  kill: "kill",
  leak: "leak",
  slow: "slow",
  burn: "burn",
  settle: "settle",
  music: "music",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

/* -------------------------------------------------------------------------- */
/* Produced assets (specs/assets.md)                                          */
/* -------------------------------------------------------------------------- */

/**
 * "Every produced file lands under `assets/` at the repository root, at the exact
 * path" the spec's tree gives it. Each path is written relative to this root.
 */
export const ASSET_ROOT = "assets/";

/** "Produce these twelve, each at `assets/fx/<effect>.json`", in that table's order. */
export const EFFECTS = [
  "build",
  "combine",
  "bolt",
  "chain",
  "spray",
  "ring",
  "impact",
  "death",
  "leak",
  "slow",
  "burn",
  "aura",
] as const;

export type EffectName = (typeof EFFECTS)[number];

/* -------------------------------------------------------------------------- */
/* The surface itself (specs/instrumentation.md)                              */
/* -------------------------------------------------------------------------- */

/** "The surface carries `version` (`FOUNDRY_DEBUG_VERSION`, `5`), a plain number". */
export const FOUNDRY_DEBUG_VERSION = 5;

/* -------------------------------------------------------------------------- */
/* The figures the specification states as a rule rather than as a table      */
/* -------------------------------------------------------------------------- */
//
// Everything below is derived from the tables above, which are this project's own
// transcription of the seeded specification and read nothing out of the build.
// What is derived HERE is what a check needs and the specification states as a
// rule rather than as a table: where a tile is on the stage, what a component's
// damage is at a tier, what a tower's upgrade costs. Each derivation is the
// arithmetic its `specs/` page states, so a check asserting against one is
// asserting against the specification.

/** A point on the stage, in logical units. */
export interface Point {
  x: number;
  y: number;
}

/** The anchors a `FOOTPRINT` by `FOOTPRINT` structure may take. */
export const MAX_ANCHOR_COL = GRID_COLS - FOOTPRINT;
export const MAX_ANCHOR_ROW = GRID_ROWS - FOOTPRINT;

/** The center of tile `(col, row)`, in logical units (specs/yard.md). */
export function tileCenter(col: number, row: number): Point {
  return { x: TILE * col + TILE / 2, y: BOARD_Y + TILE * row + TILE / 2 };
}

/**
 * The center of a structure anchored at `(col, row)`: the point range, targeting
 * and drawing are all measured from (specs/yard.md).
 */
export function structureCenter(col: number, row: number): Point {
  return { x: TILE * (col + 1), y: BOARD_Y + TILE * (row + 1) };
}

/**
 * The row a waypoint platform's stem turns around: "`(c, r + 1)` when `r < 16`,
 * otherwise `(c, r - 1)`" (specs/yard.md).
 */
export const PLATFORM_STEM_PIVOT_ROW = 16;

/**
 * The four tiles a waypoint platform anchored at `(col, row)` covers: the three
 * of its arm, and the stem, which points into the yard (specs/yard.md).
 */
export function platformTiles(col: number, row: number): Tile[] {
  return [
    { col: col - 1, row },
    { col, row },
    { col: col + 1, row },
    { col, row: row < PLATFORM_STEM_PIVOT_ROW ? row + 1 : row - 1 },
  ];
}

/** The map of that identifier. */
export function mapById(id: MapId): FoundryMap {
  const found = MAPS.find((m) => m.id === id);
  if (found === undefined) throw new Error(`no map ${id}`);
  return found;
}

/**
 * The whole ordered chain of a map: the entry, its six waypoints, the collector.
 *
 * The checkpoint a unit heads for is numbered from `1`, so `chain(map)[i]` is the
 * checkpoint `waypointIndex` `i` names once the entry is dropped — see
 * {@link checkpoint}.
 */
export function chain(map: FoundryMap): Tile[] {
  return [map.entry, ...map.waypoints, map.collector];
}

/** The `waypointIndex` a unit heading for the collector reports. */
export const COLLECTOR_WAYPOINT = 7;

/** The checkpoint a `waypointIndex` of `1`–`7` names (specs/instrumentation.md). */
export function checkpoint(map: FoundryMap, waypointIndex: number): Tile {
  const found =
    waypointIndex === COLLECTOR_WAYPOINT
      ? map.collector
      : map.waypoints[waypointIndex - 1];
  if (found === undefined) {
    throw new RangeError(`no checkpoint ${waypointIndex}`);
  }
  return found;
}

/** A route's length is in TILES: an orthogonal step is 1, a diagonal sqrt(2). */
export const STEP_ORTHOGONAL = 1;
export const STEP_DIAGONAL = Math.SQRT2;

/** What clearing wave `n` pays, in Charge (specs/economy.md). */
export function waveBonus(n: number): number {
  return WAVE_BONUS_BASE + WAVE_BONUS_STEP * n;
}

/** The difficulty of that identifier. */
export function difficultyById(id: DifficultyId): Difficulty {
  const found = DIFFICULTIES.find((d) => d.id === id);
  if (found === undefined) throw new Error(`no difficulty ${id}`);
  return found;
}

/** The two milestone waves of a run of `N` waves: `round(N / 2)` and `N`. */
export function milestoneWaves(waves: number): [number, number] {
  return [Math.round(waves / 2), waves];
}

/**
 * A unit's maximum health on wave `w` (specs/difficulty.md):
 * `round(baseHealth * baseMult * [(1 + k(w - 1)) + c(r^(w-1) - 1)])`, to the
 * nearest whole number with an exact half rounding up.
 */
export function scaledHp(
  baseHealth: number,
  wave: number,
  difficulty: Difficulty,
): number {
  const w = Math.max(1, wave);
  const { baseMult, k, c, r } = difficulty;
  const bracket = 1 + k * (w - 1) + c * (Math.pow(r, w - 1) - 1);
  return Math.round(baseHealth * baseMult * bracket);
}

/** The roster entry of that type. */
export function loadDef(type: LoadType): LoadUnitType {
  const found = LOAD_ROSTER.find((u) => u.type === type);
  if (found === undefined) throw new Error(`no roster entry ${type}`);
  return found;
}

/** Every argument `spawnUnit` takes, in the order specs/instrumentation.md lists. */
export const SPAWN_TYPES: readonly SpawnType[] = [
  ...LOAD_TYPES,
  OVERLOAD_TYPE as SpawnType,
];

/** The seven base types that fire. The Regulator never does. */
export const FIRING_TYPES: readonly ComponentType[] = [
  ...FIRING_COMPONENT_TYPES,
];

/** The one base type that never fires. */
export const NON_FIRING_TYPE: ComponentType = "regulator";

/** The five quality tiers, in ladder order. */
export const TIERS: readonly Tier[] = [1, 2, 3, 4, 5];

/** A base component's damage per shot at `tier`, before any aura. */
export function componentDamage(type: ComponentType, tier: Tier): number {
  return BASE_STATS[type].damage * QUALITY_MULT[tier - 1]!;
}

/** A base component's range at `tier`. The Regulator has none, and reports `0`. */
export function componentRange(type: ComponentType, tier: Tier): number {
  const base = BASE_STATS[type].range;
  return base === null ? 0 : base + RANGE_PER_TIER * (tier - 1);
}

/** A base component's shots per second. Flat across tiers. */
export function componentFireRate(type: ComponentType): number {
  return BASE_STATS[type].fireRate ?? 0;
}

/** The combination tower of that identifier. */
export function comboDef(id: ComboId): Combo {
  const found = COMBOS.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no combination tower ${id}`);
  return found;
}

/** The four-rung upgrade track a combination tower climbs. */
export const COMBO_LEVELS: readonly number[] = Array.from(
  { length: COMBO_MAX_LEVEL + 1 },
  (_unused, level) => level,
);

/** A landed tower's damage at `level` (specs/combinations.md). */
export function comboDamage(id: ComboId, level: number): number {
  return comboDef(id).damage * COMBO_DAMAGE_MULT[level]!;
}

/** A landed tower's range at `level` (specs/combinations.md). */
export function comboRange(id: ComboId, level: number): number {
  return comboDef(id).range + COMBO_RANGE_BONUS[level]!;
}

/**
 * The Charge that raises a tower to `level`, rounded to the nearest whole number
 * with an exact half rounding up (specs/combinations.md).
 */
export function comboUpgradeCost(id: ComboId, level: number): number {
  return Math.round(comboDef(id).damage * COMBO_UPGRADE_COST_FRAC[level - 1]!);
}

/** The Charge that raises refinement from `level - 1` to `level`. */
export function refinementCost(level: number): number {
  const cost = REFINEMENT_COSTS[level - 1];
  if (cost === undefined) throw new RangeError(`no refinement level ${level}`);
  return cost;
}

/** The one key of each action, for a check that presses rather than holds. */
export function keyFor(action: ActionName): string {
  return BINDINGS[action][0]!;
}

/**
 * The key that fires `pause-menu` alone.
 *
 * `specs/controls.md` binds the action to `Escape, KeyP` and separates the two:
 * "`KeyP` fires `pause-menu` alone, so it opens the pause menu whatever is pending
 * and leaves the held rock, the selection, and the open overlay exactly as they
 * were", while `Escape` fires `back` first and spends the press on it.
 */
export const PAUSE_MENU_KEY = BINDINGS["pause-menu"][1]!;

/**
 * A key no action is bound to, for a check that needs a keystroke to change
 * nothing.
 */
export const UNBOUND_KEY = "KeyZ";

/* -------------------------------------------------------------------------- */
/* What the specification leaves to the build                                 */
/* -------------------------------------------------------------------------- */
//
// This section re-exports a value the specs leave open — one a check reads to
// DRIVE the build or to LOCATE what the build drew, and never compares against —
// by name, one binding at a time, from the module of the build that holds it.
//
// ARC FOUNDRY'S LIST IS ONE NAME LONG. `specs/overview.md` leaves the palette to
// the build and requires only that "the letterbox bars around the stage carry the
// stage's background color", so the colour itself is the build's. The harness
// stands the engine up over it and paints the letterbox it expects with it, and
// then compares the BARS THE BUILD DREW against that same colour: what is graded
// is that the two agree, never that the colour is any particular one.
//
// The two values that most often belong here do not:
//
//   * The touch layout. `specs/controls.md` names it — "stood up with the
//     `LAYOUT` (`single-vertical`) touch layout" — so it is transcribed above
//     rather than asked of the build.
//   * Where a menu entry, a panel control, a status control, a status READ or an
//     ingredient cell of the recipe book is drawn. That IS the build's, and
//     `specs/instrumentation.md` requires the build to report each rectangle
//     through `menuButtons`, `panelButtons`, `pressControls`, `statusControls`,
//     `statusReadouts` and `recipeEntries`. A check asks the running build for the
//     geometry through the debug surface, which is a reading rather than an
//     import, so no constant stands for it here.
//
// So this file takes one binding from the build's entry, `../src/game`, and
// nothing from `../src/constants`. A second binding appearing below is the signal
// that the case is drifting back toward grading the build against itself, so keep
// the list readable and keep it short.

/** The colour the build clears the stage to (`specs/overview.md`). */
export { BACKGROUND } from "../src/game";
