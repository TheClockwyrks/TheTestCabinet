// Arc Foundry — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation. Where a
// spec states a value it also names the constant that holds it, and this module
// is where that constant lives.
//
// Every position and size is in the fixed 1280x720 logical coordinate space
// defined by `specs/overview.md` (origin top-left, x right, y down). That space
// is the engine's logical design field: the engine scales and letterboxes it
// onto the canvas, and the game leaves the camera at rest, so world units and
// these logical units coincide, no value here is ever expressed in real pixels,
// and gameplay never leaves logical space. The pointer position the game reads
// is in these same units, so a hit test against a tile center needs no
// conversion.
//
// Speeds are logical units per second, durations are seconds, and every rate is
// per second, integrated against the delta time the engine hands each tick.
// Damage, health, Charge, and Grid Integrity are unitless game values, and a
// route length is in tiles.
//
// THE LOOK IS NOT HERE, AND THAT IS DELIBERATE. Arc Foundry fixes no palette, no
// font, no panel layout, no component artwork, and no effect styling. There is
// not a single color or type face in this file, and there is not meant to be
// one. `specs/overview.md` states what a player has to read at a glance, and
// `specs/assets.md` states which tool produces each file and where it lands; how
// the yard looks is the build's to design.
//
// A figure this file derives rather than restates says so where it is defined:
// the per-tier damage and range tables of `specs/components.md` follow from
// BASE_STATS with QUALITY_MULT and RANGE_PER_TIER, so they are computed rather
// than duplicated.

// ---- Stage ---------------------------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

// ---- The three stage regions (specs/overview.md) --------------------------

/** The status bar spans the full stage width, `y` `0` to `BAR_H`. */
export const BAR_H = 56;

/** The build panel spans `x` `PANEL_X` to the right edge, below the bar. */
export const PANEL_X = 1000;
export const PANEL_W = 280;

/** The yard region: everything left of the panel and below the bar. */
export const BOARD_X = 0;
export const BOARD_Y = 56;
export const BOARD_W = 1000;
export const BOARD_H = 664;

// ---- The tile grid (specs/yard.md) ---------------------------------------

/** The yard's grid, anchored at the yard region's top-left corner. */
export const GRID_COLS = 50;
export const GRID_ROWS = 33;

/** The side of one square tile. */
export const TILE = 20;

/**
 * Every structure's footprint, in tiles on a side. A candidate, a component, a
 * blocker, and a combination tower all occupy `FOOTPRINT` by `FOOTPRINT`, at
 * every quality tier.
 */
export const FOOTPRINT = 2;

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

// ---- The maps (specs/yard.md) --------------------------------------------

/** The three map identifiers, in the order the map select lists them. */
export const MAP_IDS = ["substation", "switchyard", "transformer"] as const;

export type MapId = (typeof MAP_IDS)[number];

/**
 * One map: its display name, the edge tile the Load spills from, its six
 * waypoint anchors in chain order, the edge tile it grounds out at, and the
 * fixed housings it carries. Each waypoint coordinate is the ANCHOR of the
 * four-tile platform `specs/yard.md` defines; the arms and the stem follow from
 * it.
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

/** The three maps, in the order the map select lists them. */
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

// ---- The Load (specs/enemies.md) -----------------------------------------

/** The six roster types, plus the finale's Overload Dynamo. */
export const LOAD_TYPES = [
  "mote",
  "spark",
  "slug",
  "cluster",
  "filament",
  "dynamo",
] as const;

export type LoadType = (typeof LOAD_TYPES)[number];

/** The finale's unit, distinct from the `dynamo` boss of the roster. */
export const OVERLOAD_TYPE = "overload";

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

/** The roster, in the order `specs/enemies.md` tables it. */
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

/** The Overload Dynamo's ground speed, in logical units per second. */
export const OVERLOAD_SPEED = 55;

// ---- Component types (specs/components.md) -------------------------------

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

/** The seven that fire. The Regulator never fires. */
export const FIRING_COMPONENT_TYPES = [
  "capacitor",
  "coil",
  "emitter",
  "arcnode",
  "discharge",
  "choke",
  "rectifier",
] as const;

/** A base type's display name and the inspector's one-line description. */
export interface ComponentInfo {
  readonly name: string;
  readonly description: string;
}

export const COMPONENT_INFO: Readonly<Record<ComponentType, ComponentInfo>> = {
  capacitor: {
    name: "Capacitor",
    description: "A balanced single-target bolt.",
  },
  coil: {
    name: "Coil",
    description: "A bolt that chains to nearby further targets.",
  },
  emitter: {
    name: "Emitter",
    description: "A rapid, very low-damage single-target spark.",
  },
  arcnode: {
    name: "Arc-Node",
    description: "A shot that discharges over an area at its impact point.",
  },
  discharge: {
    name: "Discharge Rig",
    description: "A slow, long-range, heavy single-target bolt.",
  },
  choke: {
    name: "Choke",
    description:
      "A low-damage single-target bolt that slows the unit it strikes.",
  },
  rectifier: {
    name: "Rectifier",
    description:
      "A low-damage single-target bolt that sets a burn on the unit it strikes.",
  },
  regulator: {
    name: "Regulator",
    description: "A support node that never fires and projects a damage aura.",
  },
};

// ---- The quality ladder (specs/components.md) ----------------------------

/** One rung of the five-rung ladder. `tier` is `1` through `5`. */
export interface QualityTier {
  readonly tier: number;
  readonly id: string;
  readonly name: string;
}

/** The ladder, in tier order. */
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
 * The damage multiplier by tier: a component's damage is
 * `BASE_STATS[type].damage * QUALITY_MULT[tier - 1]`. Every per-tier damage
 * figure `specs/components.md` tables follows from this and is not restated
 * here.
 */
export const QUALITY_MULT: readonly number[] = [1, 3, 9, 40, 110];

/**
 * Range gained per rung above Scrap: a component's range is
 * `BASE_STATS[type].range + RANGE_PER_TIER * (tier - 1)`.
 */
export const RANGE_PER_TIER = 8;

// ---- Firing and targeting (specs/components.md) --------------------------

/** The five priorities, in the order the targeting control cycles them. */
export const TARGETING_PRIORITIES = [
  "first",
  "last",
  "nearest",
  "strongest",
  "weakest",
] as const;

export type TargetingPriority = (typeof TARGETING_PRIORITIES)[number];

/** Every firing structure's priority on landing. */
export const DEFAULT_TARGETING: TargetingPriority = "first";

/** A launched projectile's speed, in logical units per second. */
export const PROJECTILE_SPEED = 520;

/** A projectile applies its shot within this distance of its target. */
export const PROJECTILE_HIT_R = 6;

/** The most an aura, or several summed auras, multiplies damage by, less one. */
export const AURA_CAP = 1.0;

// ---- Base stats (specs/components.md) ------------------------------------

/**
 * One type's Scrap-tier stats, which every higher tier scales from. The
 * Regulator neither fires nor reaches, so its range and fire rate are `null`
 * and its reach is `REGULATOR_AURA` instead.
 */
export interface BaseStats {
  readonly range: number | null;
  /** Shots per second. */
  readonly fireRate: number | null;
  readonly damage: number;
}

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

// ---- The signature numbers, by tier (specs/components.md) ----------------

/** How far a Coil's hit leaps from the last unit it struck. */
export const COIL_LEAP_RANGE = 70;

/** Each leap's share of the previous hit's damage. */
export const COIL_FALLOFF = 0.7;

/** The most additional leaps a Coil's chain takes, indexed by `tier - 1`. */
export const COIL_LEAPS: readonly number[] = [2, 2, 3, 3, 4];

/** The Arc-Node's splash radius, indexed by `tier - 1`. */
export const ARCNODE_SPLASH: readonly number[] = [42, 47, 52, 57, 62];

/** How long a Choke's slow holds, in seconds. Flat at every tier. */
export const CHOKE_SLOW_DUR = 1.2;

/** The Choke's slow amount, indexed by `tier - 1`. */
export const CHOKE_SLOW: readonly number[] = [0.22, 0.25, 0.28, 0.31, 0.34];

/** A Rectifier's burn is `shotDamage * RECTIFIER_BURN_FRAC` per second. */
export const RECTIFIER_BURN_FRAC = 0.5;

/** How long a Rectifier's burn holds, in seconds. Flat at every tier. */
export const RECTIFIER_BURN_DUR = 2.0;

/** The Regulator's reach and the damage bonus it projects, at one tier. */
export interface AuraRung {
  readonly radius: number;
  readonly bonus: number;
}

/** The Regulator's aura, indexed by `tier - 1`. */
export const REGULATOR_AURA: readonly AuraRung[] = [
  { radius: 90, bonus: 0.1 },
  { radius: 96, bonus: 0.13 },
  { radius: 102, bonus: 0.16 },
  { radius: 108, bonus: 0.19 },
  { radius: 114, bonus: 0.22 },
];

// ---- Combination towers (specs/combinations.md) --------------------------

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

/** The top rung of the upgrade track. A tower lands at level `0`. */
export const COMBO_MAX_LEVEL = 3;

/** A landed tower's damage is `damage * COMBO_DAMAGE_MULT[level]`. */
export const COMBO_DAMAGE_MULT: readonly number[] = [0.5, 0.63, 0.78, 1.02];

/** A landed tower's range is `range + COMBO_RANGE_BONUS[level]`. */
export const COMBO_RANGE_BONUS: readonly number[] = [0, 4, 8, 12];

/**
 * The Charge cost of reaching a level, as a fraction of the tower's reference
 * damage, indexed by `level - 1`. The product is rounded to the nearest
 * integer, with an exact half rounding up.
 */
export const COMBO_UPGRADE_COST_FRAC: readonly number[] = [0.8, 1.5, 2.8];

/** One ingredient of a recipe: a base type at an exact quality tier. */
export interface RecipeIngredient {
  readonly type: ComponentType;
  readonly tier: number;
}

/**
 * The abilities a tower carries. Each behaves exactly as
 * `specs/components.md` defines it, and every parameter is flat across level.
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
 * One tower's reference block: the figures a level-`3` tower scales toward. A
 * landed tower's live damage and range come from its level, through
 * `COMBO_DAMAGE_MULT` and `COMBO_RANGE_BONUS`.
 */
export interface Combo {
  readonly id: ComboId;
  readonly name: string;
  /** The exact multiset of base ingredients the fold consumes. */
  readonly recipe: readonly RecipeIngredient[];
  readonly range: number;
  /** Shots per second. Flat across level. */
  readonly fireRate: number;
  readonly damage: number;
  readonly abilities: ComboAbilities;
  readonly description: string;
}

/** The twelve, in the order `specs/combinations.md` lists them. */
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

// ---- The scrap-press (specs/scrap-press.md) ------------------------------

/** The rock stamps each build phase grants. Unused stamps do not carry over. */
export const STAMPS_PER_LEVEL = 5;

/** The chance of each of the eight base types on a roll. Refinement leaves it alone. */
export const TYPE_ROLL_ODDS = 0.125;

/** The top rung of the refinement track. A run starts at `0`. */
export const REFINEMENT_MAX = 8;

/**
 * The quality-roll distribution at each refinement level `R`, indexed by `R`,
 * each row running Scrap through Tesla-Prime and summing to `1`.
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
 * The Charge cost of reaching each refinement level from the one below it,
 * indexed by `R - 1`, so reaching `R1` costs `REFINEMENT_COSTS[0]`.
 */
export const REFINEMENT_COSTS: readonly number[] = [
  20, 50, 80, 110, 140, 170, 200, 230,
];

// ---- Charge and Grid Integrity (specs/economy.md) ------------------------

/** What a run opens with. Both are the same at every difficulty. */
export const START_CHARGE = 10;
export const START_INTEGRITY = 20;

/** The wave-clear bonus is `WAVE_BONUS_BASE + WAVE_BONUS_STEP * waveNumber`. */
export const WAVE_BONUS_BASE = 8;
export const WAVE_BONUS_STEP = 2;

// ---- Difficulty (specs/difficulty.md) ------------------------------------

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

// ---- Screens and phases (specs/ui.md, specs/instrumentation.md) ----------

/** The eight screens the game is a state machine over. */
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

/** What a structure on the yard is. */
export const STRUCTURE_KINDS = [
  "candidate",
  "component",
  "combo",
  "blocker",
] as const;

export type StructureKind = (typeof STRUCTURE_KINDS)[number];

// ---- Screen copy (specs/ui.md, specs/hud.md) -----------------------------

export const TITLE_TEXT = "ARC FOUNDRY";
export const TAGLINE_TEXT = "GROUND THE LOAD";

/** The title menu, in this order. */
export const TITLE_ITEMS = ["SALVAGE", "HOW TO PLAY"] as const;

/** The pause menu, in this order. */
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;

/** The victory screen's menu, in this order. */
export const VICTORY_ITEMS = ["PLAY AGAIN", "MENU"] as const;

/** The defeat screen's menu, in this order. */
export const OVERLOAD_ITEMS = ["TRY AGAIN", "MENU"] as const;

/** The entry every map-select and difficulty-select screen ends on. */
export const BACK_ITEM = "BACK";

/** The status bar's read while the game is paused in place. */
export const PAUSED_TEXT = "PAUSED";

/** The status bar's read while the finale runs. */
export const OVERLOAD_TEXT = "OVERLOAD";

/** The status bar's wave read during a build phase. */
export const BUILD_TEXT = "BUILD";

/** The press control's label. */
export const STAMP_TEXT = "STAMP";

/** The harvest prompt, before wave `1` and in every build phase after it. */
export const HARVEST_PROMPT_START = "KEEP OR COMBINE A ROLL TO START";
export const HARVEST_PROMPT_SEND = "KEEP OR COMBINE A ROLL TO SEND";

/** Grid Integrity reads as an alert at or below this value. */
export const INTEGRITY_ALERT = 5;

// ---- The panel's controls (specs/hud.md, specs/instrumentation.md) -------

/**
 * The inspector's actions, in the fixed slot order the panel draws them. Every
 * one is drawn for as long as the structure stays selected; an action that is
 * unavailable right now is drawn disabled in its slot.
 */
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

/** The label the inspector draws for each of them. */
export const PANEL_ACTION_LABELS: Readonly<Record<PanelAction, string>> = {
  keep: "KEEP",
  downgrade: "DOWNGRADE",
  combine: "COMBINE",
  "combine-special": "COMBINE SPECIAL",
  upgrade: "UPGRADE",
  targeting: "TARGETING",
  dismantle: "DISMANTLE",
};

/** The status bar's five controls, each of which reads its own current value. */
export const STATUS_CONTROLS = [
  "combos",
  "damage",
  "speed",
  "pause",
  "mute",
] as const;

export type StatusControl = (typeof STATUS_CONTROLS)[number];

/** Every choice a menu screen offers, by the identifier it is reported under. */
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

// ---- Input actions (specs/controls.md) -----------------------------------

/**
 * The touch layout whose vocabulary the game speaks: one vertical list, which
 * is what every menu is, plus the menu vocabulary every layout carries.
 */
export const LAYOUT = "single-vertical";

/**
 * Every action Arc Foundry registers. The layout supplies `up`, `down`,
 * `confirm`, `back`, `pause`, and `mute`; the rest are Arc Foundry's own and
 * sit beyond the layout.
 */
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
  "combos",
  "damage",
  "mute",
  "up",
  "down",
  "confirm",
  "back",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The key each action is bound to, as a `KeyboardEvent.code` so a binding is a
 * physical key rather than a layout-dependent character. Each is read as a
 * press edge, so holding a key fires its action once.
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
  combos: ["KeyV"],
  damage: ["KeyL"],
  mute: ["KeyM"],
  up: ["ArrowUp"],
  down: ["ArrowDown"],
  confirm: ["Enter"],
  back: ["Escape"],
};

/** The speed multipliers, in the order the speed control cycles them. */
export const SPEEDS = [1, 2, 4, 8] as const;

export type Speed = (typeof SPEEDS)[number];

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The twelve cue names, one per event. Define and play exactly these. */
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

// ---- Produced assets (specs/assets.md) -----------------------------------

/**
 * The one root every produced file is committed under and loaded from. Each
 * path `specs/assets.md` fixes is written relative to it.
 */
export const ASSET_ROOT = "assets/";

/** The twelve particle systems, each at `fx/<effect>.json` under that root. */
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

/** The frames every produced animation cycle runs, `0.png` through `3.png`. */
export const CYCLE_FRAMES = 4;

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const FOUNDRY_DEBUG_VERSION = 3;

/** The seed `reset` restores when the caller names none. */
export const DEFAULT_SEED = 1;
