// Deepcore — every figure the specification fixes, under the name it gives it.
//
// The specification names each number, identifier, key binding, cue name, and piece
// of screen copy it fixes; this module is where those names live, and every other
// module imports them from here rather than restating a value. Anything the
// specification leaves open — the palette, the type, the layout — is decided here
// too, kept beside the fixed figures so a tuning pass has one place to look.

import type {
  Band,
  BuildingId,
  ItemId,
  Material,
  MinerState,
  Ore,
  RocketComponentId,
  UpgradeTrack,
} from "./types";

// ---------------------------------------------------------------------------
// The stage (specs/overview.md)
// ---------------------------------------------------------------------------

/** Logical design width of the stage. */
export const STAGE_W = 1280;
/** Logical design height of the stage. */
export const STAGE_H = 720;

/** Height of the always-visible status bar along the top of the stage. */
export const HUD_H = 56;

/** The mine viewport: the stage below the status bar. */
export const VIEW_W = STAGE_W;
export const VIEW_H = STAGE_H - HUD_H; // 664

// ---------------------------------------------------------------------------
// The tile grid (specs/world.md)
// ---------------------------------------------------------------------------

/** Side of a square tile, in world units. */
export const TILE = 80;

/** Grid width in columns, including the two bedrock border columns. */
export const WORLD_COLS = 32;
/** World width in units. */
export const WORLD_W = WORLD_COLS * TILE; // 2560

/** The playable column span; columns 0 and 31 are the bedrock border. */
export const PLAYABLE_COL_MIN = 1;
export const PLAYABLE_COL_MAX = WORLD_COLS - 2; // 30

/** The deepest row at the Standard world size. */
export const STANDARD_ROWS = 500;

/** Meters of depth per row. */
export const METERS_PER_ROW = 5;

/** World y of the surface ground line: the top of row 1, which the miner stands on. */
export const SURFACE_Y = TILE; // 80

/** The surface row: open sky and camp ground. */
export const SURFACE_ROW = 0;

/** The column of the Core tile in the Core chamber. */
export const CORE_COL = 16;

/** The open cell at row 1 that leads down out of the camp. */
export const CAVE_MOUTH_COL = 26;

/** The column the miner spawns above at the start of an expedition. */
export const SPAWN_COL = 4;

/** Farthest left the camera may scroll to, so the border columns never leave the frame. */
export const MAX_CAM_X = WORLD_W - VIEW_W; // 1280

// ---------------------------------------------------------------------------
// The camera (specs/world.md)
// ---------------------------------------------------------------------------

/** Full vertical lead, in world units. */
export const CAM_LEAD_MAX = 212;
/** Seconds of sustained travel needed to reach full lead. */
export const CAM_LEAD_RAMP = 2;
/** Rate multiplier applied while the lead is moving back toward zero. */
export const CAM_UNWIND_MULT = 4;
/** Vertical speed below which the miner counts as still. */
export const CAM_STILL_SPEED = 40;

// ---------------------------------------------------------------------------
// World size (specs/world.md)
// ---------------------------------------------------------------------------

export type WorldSize = "quick" | "standard" | "marathon";

/** Depth multiplier applied to STANDARD_ROWS, per world size. */
export const WORLD_SIZE_SCALE: Record<WorldSize, number> = {
  quick: 0.5,
  standard: 1,
  marathon: 2,
};

/** The three sizes in the order the size-select screen lists them. */
export const WORLD_SIZE_ORDER: readonly WorldSize[] = [
  "quick",
  "standard",
  "marathon",
];

/** The size an expedition opens at before the player chooses one. */
export const DEFAULT_WORLD_SIZE: WorldSize = "standard";

/** The Core chamber's row at a world size. */
export function coreRowFor(size: WorldSize): number {
  return Math.round(STANDARD_ROWS * WORLD_SIZE_SCALE[size]);
}

/** How deep the Core lies at a world size, in meters. */
export function coreDepthMetersFor(size: WorldSize): number {
  return coreRowFor(size) * METERS_PER_ROW;
}

/**
 * The fraction of the descent a row sits at: 0 at row 1, 1 at the deepest minable row.
 * Every depth-varying rule in the game is expressed against this rather than a row, so
 * its shape is identical at every world size.
 */
export function depthFraction(row: number, coreRow: number): number {
  if (coreRow <= 1) return 0;
  return (row - 1) / (coreRow - 1);
}

// ---------------------------------------------------------------------------
// The four depth bands (specs/world.md)
// ---------------------------------------------------------------------------

/** Band lookup order, shallow to deep. Its index is the band index. */
export const BAND_ORDER: readonly Band[] = [
  "topsoil",
  "rockbed",
  "deepstone",
  "coreshell",
];

/** The health of every minable tile in a band. */
export const BAND_HEALTH: Record<Band, number> = {
  topsoil: 4,
  rockbed: 8,
  deepstone: 12,
  coreshell: 16,
};

/** The band a depth fraction falls in. */
export function bandAtFraction(f: number): Band {
  const index = Math.min(3, Math.max(0, Math.floor(4 * f)));
  return BAND_ORDER[index]!;
}

// ---------------------------------------------------------------------------
// What generation places (specs/world.md)
// ---------------------------------------------------------------------------

/** The share of minable cells that hold an ore vein, the same at every depth. */
export const ORE_DENSITY = 0.14;
/** No ore appears above this row, so the first three rows of ground are plain rock. */
export const ORE_MIN_ROW = 4;

/** Unbreakable stone's share, at the top of the rockbed and the bottom of the coreshell. */
export const STONE_DENSITY_MIN = 0.02;
export const STONE_DENSITY_MAX = 0.08;

/** A gas pocket's share, over the same span. */
export const GAS_DENSITY_MIN = 0.004;
export const GAS_DENSITY_MAX = 0.012;

/** Lava's share, from the top of the deepstone to the bottom of the coreshell. */
export const LAVA_DENSITY_MIN = 0.03;
export const LAVA_DENSITY_MAX = 0.1;

/** How far a measured share may sit from the stated one, relative to it. */
export const DENSITY_TOLERANCE = 0.25;

/** The depth fraction at which the rockbed begins, where stone and gas first appear. */
export const ROCKBED_TOP_FRACTION = 0.25;
/** The depth fraction at which the deepstone begins, where lava first appears. */
export const DEEPSTONE_TOP_FRACTION = 0.5;

/** Unbreakable stone's share of minable cells at a depth fraction. */
export function stoneDensityAt(f: number): number {
  if (f < ROCKBED_TOP_FRACTION) return 0;
  const t = (f - ROCKBED_TOP_FRACTION) / (1 - ROCKBED_TOP_FRACTION);
  return STONE_DENSITY_MIN + (STONE_DENSITY_MAX - STONE_DENSITY_MIN) * t;
}

/** A gas pocket's share of minable cells at a depth fraction. */
export function gasDensityAt(f: number): number {
  if (f < ROCKBED_TOP_FRACTION) return 0;
  const t = (f - ROCKBED_TOP_FRACTION) / (1 - ROCKBED_TOP_FRACTION);
  return GAS_DENSITY_MIN + (GAS_DENSITY_MAX - GAS_DENSITY_MIN) * t;
}

/** Lava's share of minable cells at a depth fraction. */
export function lavaDensityAt(f: number): number {
  if (f < DEEPSTONE_TOP_FRACTION) return 0;
  const t = (f - DEEPSTONE_TOP_FRACTION) / (1 - DEEPSTONE_TOP_FRACTION);
  return LAVA_DENSITY_MIN + (LAVA_DENSITY_MAX - LAVA_DENSITY_MIN) * t;
}

// ---------------------------------------------------------------------------
// The surface camp (specs/world.md)
// ---------------------------------------------------------------------------

/** Clear ground kept between any two building footprints, in world units. */
export const BUILDING_GAP = 40;

/** The footprint every building is drawn and reached at. */
export const BUILDING_W = 112;
export const BUILDING_H = 132;

export interface BuildingDef {
  readonly id: BuildingId;
  readonly label: string;
  /** The camp column the footprint is centered on. */
  readonly col: number;
}

/**
 * The six buildings, spread along the camp. Every footprint's base rests on
 * SURFACE_Y, they are 320 units apart and so far clear of BUILDING_GAP, and the
 * rightmost stands well left of the cave mouth at CAVE_MOUTH_COL.
 */
export const BUILDINGS: readonly BuildingDef[] = [
  { id: "fuel-depot", label: "Fuel Depot", col: 3 },
  { id: "ore-market", label: "Ore Market", col: 7 },
  { id: "save-pad", label: "Save Pad", col: 11 },
  { id: "upgrade-shop", label: "Upgrade Shop", col: 15 },
  { id: "supply-depot", label: "Supply Depot", col: 19 },
  { id: "launch-pad", label: "Launch Pad", col: 23 },
];

/** How near a building the miner must stand to activate it, in world units. */
export const BUILDING_REACH = TILE * 1.6;

// ---------------------------------------------------------------------------
// The prospector (specs/character.md)
// ---------------------------------------------------------------------------

/** The miner's collision box. */
export const MINER_W = 56;
export const MINER_H = 72;

/** Downward acceleration, in units per second squared. */
export const GRAVITY = 1500;
/** Walk and lateral drift speed, in units per second. */
export const WALK_SPEED = 250;
/** Terminal fall speed with an empty bay. */
export const FALL_TERMINAL_EMPTY = 950;
/** Terminal fall speed at the lift limit. */
export const FALL_TERMINAL_LOADED = 1600;

/** The fraction of the empty climb cap that survives a load at the lift limit. */
export const CLIMB_CAP_FLOOR = 0.58;

/** Seconds the hurt state holds from the blow that caused it. */
export const HURT_TIME = 0.4;

// ---------------------------------------------------------------------------
// Drilling (specs/character.md)
// ---------------------------------------------------------------------------

/** Seconds between drill hits. */
export const DRILL_HIT_INTERVAL = 0.125;
/** Fuel each drill hit spends. */
export const DRILL_HIT_FUEL = 0.25;

// ---------------------------------------------------------------------------
// Fuel (specs/character.md)
// ---------------------------------------------------------------------------

/** Thrust burn per second at zero upward speed. */
export const THRUST_BURN_MAX = 5;
/** Thrust burn per second at or above the cruise speed. */
export const THRUST_BURN_MIN = 2;
/** Upward speed at which the eased thrust burn is reached. */
export const CRUISE_SPEED = 900;
/** Fuel per second spent drifting laterally in the air. */
export const AIR_BURN = 2;
/** Fuel per second life support spends below the surface ground line. */
export const LIFE_SUPPORT_BURN = 0.4;

/** The world size's multiplier on the thrust burn, and nothing else. */
export const THRUST_BURN_SIZE_MULT: Record<WorldSize, number> = {
  quick: 2,
  standard: 1,
  marathon: 0.67,
};

/** The thrust burn per second at an upward speed, before the world size's multiplier. */
export function thrustBurnAt(upSpeed: number): number {
  const t = Math.min(1, Math.max(0, upSpeed) / CRUISE_SPEED);
  return THRUST_BURN_MAX + (THRUST_BURN_MIN - THRUST_BURN_MAX) * t;
}

/** Fraction of the maximum below which the fuel gauge alerts and the alarm plays. */
export const LOW_FUEL_FRACTION = 0.2;
/** Fraction of the maximum below which the hull gauge alerts. */
export const LOW_HULL_FRACTION = 0.25;

// ---------------------------------------------------------------------------
// Hazards (specs/hazards.md)
// ---------------------------------------------------------------------------

/** Gas damage where gas first appears, at depth fraction 0.25. */
export const GAS_DAMAGE_MIN = 60;
/** Gas damage at the deepest minable row. */
export const GAS_DAMAGE_MAX = 400;
/** Radius, in tiles, within which a detonation hits the miner. */
export const GAS_BLAST_TILES = 1.5;
/** Speed the blast shoves the miner away at. */
export const GAS_KNOCKBACK = 700;
/** Seconds within which every gas pocket on screen wisps at least once. */
export const GAS_SEEP_PERIOD = 2;

/** Hull a gas detonation at a depth fraction deals. */
export function gasDamageAt(f: number): number {
  return (
    GAS_DAMAGE_MIN +
    ((GAS_DAMAGE_MAX - GAS_DAMAGE_MIN) *
      Math.max(0, f - ROCKBED_TOP_FRACTION)) /
      0.75
  );
}

/** Hull drained per second while the miner touches lava, before the radiator. */
export const LAVA_CONTACT_DPS = 32;
/** Hull burned by drilling through a deepstone lava cell, before the radiator. */
export const LAVA_DRILL_DEEPSTONE = 60;
/** Hull burned by drilling through a coreshell lava cell, before the radiator. */
export const LAVA_DRILL_CORESHELL = 100;

/** The lump a lava cell of a band charges when it breaks, before the radiator. */
export const LAVA_DRILL_DAMAGE: Record<Band, number> = {
  topsoil: 0,
  rockbed: 0,
  deepstone: LAVA_DRILL_DEEPSTONE,
  coreshell: LAVA_DRILL_CORESHELL,
};

/** Landing speed below which a landing costs no hull. */
export const IMPACT_SAFE_SPEED = 700;
/** Hull per unit of downward speed above the safe speed. */
export const IMPACT_DAMAGE_RATE = 0.1;

/** Seconds a Core Sample's destabilization timer runs for. */
export const CORE_TIMER = 90;
/** Radius, in tiles, a jettisoned Sample's detonation reaches. */
export const CORE_BLAST_TILES = 3;

/** Seconds between a first hazard hit and its notice card appearing. */
export const NOTICE_DELAY = 1.5;
/** Seconds a notice card stays up before fading on its own. */
export const NOTICE_FADE = 8;

/** Screen shake, which is render-only and never moves the simulation. */
export const SHAKE_GAS_AMP = 11;
export const SHAKE_GAS_TIME = 0.36;
export const SHAKE_IMPACT_PER_SPEED = 0.03;
export const SHAKE_CORE_AMP = 18;
export const SHAKE_CORE_TIME = 0.6;

// ---------------------------------------------------------------------------
// Ore, gemstones, and materials (specs/mining.md)
// ---------------------------------------------------------------------------

export interface OreDef {
  readonly ore: Ore;
  /** Credits one unit sells for. */
  readonly value: number;
  /** Kilograms one unit weighs. */
  readonly weightKg: number;
  /** The depth fraction this ore's frequency curve peaks at. */
  readonly peak: number;
  /** How far either side of the peak the curve reaches. */
  readonly spread: number;
  /** The curve's height at its peak. */
  readonly pick: number;
  /** True for a gemstone, which is drawn as a cut jewel rather than an ore smear. */
  readonly gem: boolean;
  /** The color the vein reads as. */
  readonly color: string;
}

/** The ten mineral ores and the three gemstones, shallow to deep. */
export const ORES: Record<Ore, OreDef> = {
  ferron: {
    ore: "ferron",
    value: 28,
    weightKg: 10,
    peak: 0.01,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#b8794a",
  },
  marlite: {
    ore: "marlite",
    value: 46,
    weightKg: 14,
    peak: 0.08,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#b8a24e",
  },
  cuprite: {
    ore: "cuprite",
    value: 65,
    weightKg: 18,
    peak: 0.19,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#4fb0a0",
  },
  argenite: {
    ore: "argenite",
    value: 150,
    weightKg: 24,
    peak: 0.36,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#cdd6e0",
  },
  cobaltine: {
    ore: "cobaltine",
    value: 240,
    weightKg: 31,
    peak: 0.49,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#7b74c8",
  },
  voltite: {
    ore: "voltite",
    value: 380,
    weightKg: 39,
    peak: 0.61,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#5a8cff",
  },
  halcite: {
    ore: "halcite",
    value: 560,
    weightKg: 48,
    peak: 0.72,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#9fc63e",
  },
  pyronium: {
    ore: "pyronium",
    value: 820,
    weightKg: 58,
    peak: 0.87,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#ff8a3a",
  },
  cindrite: {
    ore: "cindrite",
    value: 1250,
    weightKg: 70,
    peak: 0.94,
    spread: 0.34,
    pick: 1,
    gem: false,
    color: "#e0472a",
  },
  adamite: {
    ore: "adamite",
    value: 1900,
    weightKg: 84,
    peak: 0.97,
    spread: 0.45,
    pick: 0.06,
    gem: false,
    color: "#8affda",
  },
  verdite: {
    ore: "verdite",
    value: 450,
    weightKg: 48,
    peak: 0.375,
    spread: 0.125,
    pick: 0.03,
    gem: true,
    color: "#2fe36a",
  },
  roselite: {
    ore: "roselite",
    value: 1140,
    weightKg: 78,
    peak: 0.625,
    spread: 0.125,
    pick: 0.03,
    gem: true,
    color: "#ff4f7a",
  },
  aurite: {
    ore: "aurite",
    value: 2460,
    weightKg: 116,
    peak: 0.875,
    spread: 0.125,
    pick: 0.03,
    gem: true,
    color: "#ffca28",
  },
};

/** Every ore and gemstone id, in the order the tables above list them. */
export const ORE_IDS = Object.keys(ORES) as Ore[];

/** An ore's weight in the which-ore draw at a depth fraction. */
export function oreWeightAt(def: OreDef, f: number): number {
  return def.pick * Math.max(0, 1 - Math.abs(f - def.peak) / def.spread);
}

/** The band each exotic material's node is buried in. */
export const MATERIAL_BAND: Record<"resonite" | "cryenite", Band> = {
  resonite: "rockbed",
  cryenite: "deepstone",
};

/** The color each material reads as. */
export const MATERIAL_COLOR: Record<Material, string> = {
  resonite: "#4ad0ff",
  cryenite: "#b98cff",
  "core-sample": "#ff4a2a",
};

// ---------------------------------------------------------------------------
// The economy (specs/expedition.md)
// ---------------------------------------------------------------------------

/** Credits per unit of fuel at the Fuel Depot. */
export const FUEL_PRICE = 1;
/** Credits per point of hull repair at the Fuel Depot. */
export const REPAIR_PRICE = 2;
/** Units of fuel the depot's fixed increment buys. */
export const FUEL_BUY_INCREMENT = 25;
/** Points of hull the depot's fixed increment repairs. */
export const REPAIR_BUY_INCREMENT = 25;

// ---------------------------------------------------------------------------
// The upgrade tracks (specs/upgrades.md)
// ---------------------------------------------------------------------------

/** The price ladder the six five-tier tracks share; index i is the cost of tier i+1. */
export const UPGRADE_PRICES: readonly number[] = [0, 300, 750, 1900, 4100];

/** Maximum fuel, by fuel tank tier. */
export const FUEL_TANK_MAX: readonly number[] = [100, 175, 275, 400, 550];
/** Damage a drill hit removes, by drill tier. */
export const DRILL_DAMAGE: readonly number[] = [1, 1.5, 2.5, 3.5, 5];
/** Cargo capacity in slots, by cargo tier. */
export const CARGO_CAPACITY: readonly number[] = [15, 25, 40, 70, 120];
/** Maximum hull, by hull tier. */
export const HULL_MAX: readonly number[] = [100, 150, 220, 320, 450];
/** The heaviest load the jetpack can climb with, by jetpack tier. */
export const JETPACK_LIFT_LIMIT: readonly number[] = [
  350, 1100, 2850, 7400, 12700,
];
/** Empty-load climb speed cap, by jetpack tier. */
export const JETPACK_EMPTY_CLIMB: readonly number[] = [
  950, 1010, 1080, 1150, 1230,
];
/** Empty-load climb acceleration, by jetpack tier. */
export const JETPACK_EMPTY_ACCEL: readonly number[] = [
  1200, 1270, 1350, 1440, 1540,
];
/** The fraction by which lava damage is reduced, by radiator tier. */
export const RADIATOR_EFFECTIVENESS: readonly number[] = [
  0, 0.25, 0.45, 0.65, 0.8,
];
/** Scanner lock range in tiles, by scanner tier. Tier 1 is no scanner. */
export const SCANNER_RANGE: readonly number[] = [0, 10, 32];

/** The seven tracks, in the order the shop lists them. */
export const UPGRADE_TRACKS: readonly UpgradeTrack[] = [
  "fuel",
  "drill",
  "cargo",
  "hull",
  "jetpack",
  "radiator",
  "scanner",
];

/** The highest tier a track reaches. The scanner stops at 3; the rest at 5. */
export function maxTierFor(track: UpgradeTrack): number {
  return track === "scanner" ? 3 : 5;
}

/** The Credits the next tier on a track costs, or null once the track is maxed out. */
export function upgradePrice(track: UpgradeTrack, tier: number): number | null {
  if (tier >= maxTierFor(track)) return null;
  return UPGRADE_PRICES[tier] ?? null;
}

/** The drill's tier as the shop reads it, a power rating rather than raw damage. */
export const DRILL_POWER: readonly number[] = [1, 2, 3, 4, 5];

/** What the shop shows for each track's tier, and the unit it reads in. */
export const TRACK_DISPLAY: Record<
  UpgradeTrack,
  { values: readonly number[]; unit: string }
> = {
  fuel: { values: FUEL_TANK_MAX, unit: "max fuel" },
  drill: { values: DRILL_POWER, unit: "power" },
  cargo: { values: CARGO_CAPACITY, unit: "ore slots" },
  hull: { values: HULL_MAX, unit: "max hull" },
  jetpack: { values: JETPACK_LIFT_LIMIT, unit: "kg lift" },
  radiator: { values: RADIATOR_EFFECTIVENESS, unit: "dmg cut" },
  scanner: { values: SCANNER_RANGE, unit: "tiles range" },
};

/** The label the shop shows for what a track's next tier gives. */
export const UPGRADE_LABEL: Record<UpgradeTrack, string> = {
  fuel: "FUEL TANK",
  drill: "DRILL",
  cargo: "CARGO BAY",
  hull: "HULL",
  jetpack: "JETPACK",
  radiator: "RADIATOR",
  scanner: "SCANNER",
};

// ---------------------------------------------------------------------------
// Field supplies (specs/items.md)
// ---------------------------------------------------------------------------

export interface ItemDef {
  readonly id: ItemId;
  /** The number key, 1 through 6, that uses this supply during live play. */
  readonly hotkey: number;
  readonly label: string;
  readonly price: number;
  readonly blurb: string;
}

/** The six field supplies, in hotkey order. */
export const ITEMS: readonly ItemDef[] = [
  {
    id: "dynamite",
    hotkey: 1,
    label: "Dynamite",
    price: 300,
    blurb: "Clears a 3x3 block, stone too. Sets off gas.",
  },
  {
    id: "plastic-explosives",
    hotkey: 2,
    label: "Plastic Explosives",
    price: 1000,
    blurb: "Clears a 5x5 block, stone too. Sets off gas.",
  },
  {
    id: "quantum-teleporter",
    hotkey: 3,
    label: "Quantum Teleporter",
    price: 1500,
    blurb: "Drops you in over the camp at speed.",
  },
  {
    id: "matter-transmitter",
    hotkey: 4,
    label: "Matter Transmitter",
    price: 8000,
    blurb: "Sets you down at the camp, unhurt.",
  },
  {
    id: "nanobots",
    hotkey: 5,
    label: "Regen Nanobots",
    price: 4000,
    blurb: "Repairs 20 hull, capped at the maximum.",
  },
  {
    id: "emergency-fuel",
    hotkey: 6,
    label: "Emergency Fuel",
    price: 2000,
    blurb: "Adds 30 fuel, capped at the maximum.",
  },
];

/** The field supplies keyed by id. */
export const ITEM_BY_ID: Record<ItemId, ItemDef> = ITEMS.reduce(
  (acc, def) => {
    acc[def.id] = def;
    return acc;
  },
  {} as Record<ItemId, ItemDef>,
);

/** Every field supply id, in hotkey order. */
export const ITEM_IDS = ITEMS.map((i) => i.id);

/** Cells either side of the miner's cell that Dynamite clears. */
export const DYNAMITE_RADIUS = 1;
/** Cells either side of the miner's cell that Plastic Explosives clears. */
export const PLASTIC_RADIUS = 2;
/** Hull the Regenerative Nanobots repair. */
export const NANOBOT_HULL = 20;
/** Fuel the Emergency Fuel adds. */
export const EMERGENCY_FUEL = 30;

/** The height, in tiles, the Quantum Teleporter drops the miner in from. */
export const QUANTUM_DROP_MIN_TILES = 1;
export const QUANTUM_DROP_MAX_TILES = 8;
/** The downward speed it drops the miner in at. */
export const QUANTUM_VEL_MIN = 150;
export const QUANTUM_VEL_MAX = 700;

// ---------------------------------------------------------------------------
// The escape rocket (specs/rocket.md)
// ---------------------------------------------------------------------------

export interface RocketComponentDef {
  readonly id: RocketComponentId;
  readonly label: string;
  readonly credits: number;
  /** The exotic material fabricating it consumes, or null. */
  readonly material: Material | null;
}

/** The five components, in the order the checklist builds them. */
export const ROCKET_COMPONENTS: readonly RocketComponentDef[] = [
  { id: "hull-frame", label: "Hull Frame", credits: 4000, material: null },
  { id: "fuel-cells", label: "Fuel Cells", credits: 7500, material: null },
  {
    id: "guidance",
    label: "Guidance Unit",
    credits: 3000,
    material: "resonite",
  },
  {
    id: "thruster",
    label: "Thruster Assembly",
    credits: 6000,
    material: "cryenite",
  },
  {
    id: "ignition",
    label: "Ignition Core",
    credits: 5000,
    material: "core-sample",
  },
];

/** The sum of the five components' prices. */
export const ROCKET_TOTAL_CREDITS = ROCKET_COMPONENTS.reduce(
  (n, c) => n + c.credits,
  0,
);

/** Seconds the rocket rises for before the Victory screen. */
export const LAUNCH_ANIM_TIME = 2.6;

// ---------------------------------------------------------------------------
// Screens and menus (specs/ui.md)
// ---------------------------------------------------------------------------

export const TITLE_TEXT = "DEEPCORE";
export const TAGLINE_TEXT = "DIG DOWN. BUILD THE ROCKET. FLY HOME.";

/** The main menu. CONTINUE appears, and leads, only while a save exists. */
export const TITLE_ITEMS = [
  "CONTINUE",
  "NEW EXPEDITION",
  "HOW TO PLAY",
] as const;
export const MODE_ITEMS = ["STANDARD", "HARDCORE", "BACK"] as const;
export const SIZE_ITEMS = ["QUICK", "STANDARD", "MARATHON", "BACK"] as const;
export const PAUSE_ITEMS = ["RESUME", "RESTART", "QUIT TO MENU"] as const;
export const VICTORY_ITEMS = ["PLAY AGAIN", "MENU"] as const;
export const GAME_OVER_ITEMS = ["PLAY AGAIN", "MENU"] as const;
export const GAME_OVER_SAVE_ITEMS = ["CONTINUE FROM SAVE", "MENU"] as const;

/** What each world size reads as on the size-select screen. */
export const WORLD_SIZE_LABEL: Record<WorldSize, string> = {
  quick: SIZE_ITEMS[0],
  standard: SIZE_ITEMS[1],
  marathon: SIZE_ITEMS[2],
};

/** What the mode-select screen states about each mode before it is chosen. */
export const MODE_BLURB: Record<"standard" | "hardcore", string> = {
  standard:
    "STANDARD — a death lets the expedition be restored from the last save.",
  hardcore: "HARDCORE — a death deletes the save and ends the expedition.",
};

/** What the size-select screen states about each size before it is chosen. */
export const SIZE_BLURB: Record<WorldSize, string> = {
  quick: `QUICK — a half-depth mine. The Core lies ${coreDepthMetersFor("quick")} m down.`,
  standard: `STANDARD — the full mine. The Core lies ${coreDepthMetersFor("standard")} m down.`,
  marathon: `MARATHON — a double-depth mine. The Core lies ${coreDepthMetersFor("marathon")} m down.`,
};

// ---------------------------------------------------------------------------
// Controls (specs/controls.md)
// ---------------------------------------------------------------------------

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

/** Each action, against the KeyboardEvent.code values that drive it. */
export const ACTIONS: Record<Action, readonly string[]> = {
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

/** The key that shows and hides the read-only diagnostics overlay. */
export const OVERLAY_TOGGLE_CODE = "Backquote";

// ---------------------------------------------------------------------------
// The produced assets (specs/assets.md)
// ---------------------------------------------------------------------------

/** Frames per second every produced miner cycle plays at. */
export const ANIM_FPS = 12;
/** The square the miner's frames are authored to fit within. */
export const MINER_SPRITE = 80;
/** The square a status-bar icon is authored at. */
export const ICON_SIZE = 24;
/** Interchangeable rock variants produced per band. */
export const TILE_VARIANTS = 3;
/** Frames in the drill-damage crack overlay. */
export const CRACK_FRAMES = 4;

/** The miner's animation states, in the order the asset contract lists them. */
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

// ---------------------------------------------------------------------------
// The debug and automation surface (specs/instrumentation.md)
// ---------------------------------------------------------------------------

/** The version the surface reports. */
export const DEEPCORE_DEBUG_VERSION = 1;
/** The seed a reset takes when none is given. */
export const DEFAULT_SEED = 1;

// ---------------------------------------------------------------------------
// Presentation, which the specification leaves to the build
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
  ferron: "#b8794a",
  marlite: "#b8a24e",
  cuprite: "#4fb0a0",
  argenite: "#cdd6e0",
  cobaltine: "#7b74c8",
  voltite: "#5a8cff",
  halcite: "#9fc63e",
  pyronium: "#ff8a3a",
  cindrite: "#e0472a",
  adamite: "#8affda",
  verdite: "#2fe36a",
  roselite: "#ff4f7a",
  aurite: "#ffca28",
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

/** The rock fill each band is drawn over. */
export const BAND_FILL: Record<Band, string> = {
  topsoil: PALETTE.topsoilFill,
  rockbed: PALETTE.rockbedFill,
  deepstone: PALETTE.deepstoneFill,
  coreshell: PALETTE.coreshellFill,
};

/** The stage background, which the letterbox bars also carry. */
export const BACKGROUND = PALETTE.void;

/** A system monospace stack, so nothing is downloaded and the build renders offline. */
export const FONT_STACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
