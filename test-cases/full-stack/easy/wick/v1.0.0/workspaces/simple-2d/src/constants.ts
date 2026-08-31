// Wick — canonical constants. Supplied with the project. Do not edit.
//
// Every figure the specification fixes is named here exactly once, so no number
// in this build is a guess and no spec value is left to interpretation.
//
// Every length is in world units. The world is an unbounded plane measured in
// the same units as the fixed 1280x720 logical stage defined by
// `specs/overview.md` (x right, y down), and the camera keeps the lamplighter
// at the stage center, so a world point draws at
// `(wx - player.x + STAGE_CX, wy - player.y + STAGE_CY)`. That space is the
// engine's logical design size: the engine scales and letterboxes it onto the
// canvas, so no value here is ever expressed in real pixels.
//
// Every rate is per second and every duration is in seconds. The simulation
// advances in fixed ticks of TICK_DT: the frame's delta time accumulates, whole
// ticks are consumed, and the remainder waits for the next frame. Only the
// `playing` screen ticks.
//
// This file fixes no palette, font, sprite artwork, or ground pattern;
// `specs/ui.md` and `specs/assets.md` state what must be legible, and how the
// night looks is the build's to design.

// ---- Stage ---------------------------------------------------------------

/** The logical design size, from `specs/overview.md`. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The stage center, where the lamplighter is always drawn. */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

// ---- Ticks and the run clock (specs/overview.md) -------------------------

/** The fixed simulation rate, in ticks per second. */
export const TICK_HZ = 60;

/** The length of one tick, in seconds. */
export const TICK_DT = 1 / TICK_HZ;

/**
 * The slack a tick boundary allows: a tick is consumed while the accumulator
 * is at least TICK_DT − TICK_EPSILON, and a remainder whose magnitude is below
 * TICK_EPSILON is 0, so a frame of 0.5 seconds runs exactly 30 ticks.
 */
export const TICK_EPSILON = 1e-9;

/** The run clock at which dawn arrives and the run is won, in seconds. */
export const DAWN_TIME = 600;

// ---- The lamplighter (specs/world.md) ------------------------------------

/** Base move speed, in units per second, before Bellows. */
export const MOVE_SPEED = 180;

/** The lamplighter's collision circle. */
export const PLAYER_RADIUS = 12;

/** Base maximum health, before Tallow. */
export const BASE_MAX_HP = 100;

/** Base recovery, in health per second, before Tinder. */
export const BASE_RECOVERY = 0;

/** Base radius within which a gem becomes attracted, before Lure. */
export const PICKUP_RADIUS = 48;

/** The speed an attracted gem flies to the lamplighter, in units per second. */
export const GEM_SPEED = 600;

/** An attracted gem is collected within this distance of the lamplighter. */
export const COLLECT_RADIUS = 8;

/** Seconds an enemy waits between contact hits on the lamplighter. */
export const CONTACT_COOLDOWN = 0.5;

/** The least health any contact hit removes, whatever the armor. */
export const MIN_DAMAGE_TAKEN = 1;

// ---- Derived stats (specs/passives.md) -----------------------------------

/**
 * Each passive is one term in one derived stat, per level held:
 *
 *   damageMul   = 1 + WICK_DAMAGE_PER_LEVEL * wick
 *   cooldownMul = 1 - OIL_COOLDOWN_PER_LEVEL * oil
 *   areaMul     = 1 + GLASS_AREA_PER_LEVEL * glass
 *   armor       = BRASS_ARMOR_PER_LEVEL * brass
 *   amountBonus = MIRROR_AMOUNT_PER_LEVEL * mirror
 *   speedMul    = 1 + BELLOWS_SPEED_PER_LEVEL * bellows
 *   maxHp       = BASE_MAX_HP + TALLOW_HP_PER_LEVEL * tallow
 *   recovery    = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL * tinder
 *   xpMul       = 1 + SOOT_XP_PER_LEVEL * soot
 *   pickupMul   = 1 + LURE_PICKUP_PER_LEVEL * lure
 */
export const WICK_DAMAGE_PER_LEVEL = 0.1;
export const OIL_COOLDOWN_PER_LEVEL = 0.08;
export const GLASS_AREA_PER_LEVEL = 0.1;
export const BRASS_ARMOR_PER_LEVEL = 1;
export const MIRROR_AMOUNT_PER_LEVEL = 1;
export const BELLOWS_SPEED_PER_LEVEL = 0.1;
export const TALLOW_HP_PER_LEVEL = 15;
export const TINDER_RECOVERY_PER_LEVEL = 0.5;
export const SOOT_XP_PER_LEVEL = 0.1;
export const LURE_PICKUP_PER_LEVEL = 0.25;

/** The floor under every weapon's cooldown after cooldownMul, in seconds. */
export const MIN_COOLDOWN = 0.2;

// ---- Slots, levels, and offers (specs/progression.md) --------------------

export const WEAPON_SLOTS = 6;
export const PASSIVE_SLOTS = 6;

/** The level at which a base weapon stops leveling and becomes evolvable. */
export const MAX_WEAPON_LEVEL = 8;

/** How many candidates a level-up overlay presents. */
export const OFFER_COUNT = 3;

/** The xp curve: `xpToNext(level) = XP_BASE + XP_STEP * (level - 1)`. */
export const XP_BASE = 5;
export const XP_STEP = 10;

/** The offer presented when the candidate pool is empty. It fills no slot. */
export const LAMP_OIL_ID = "lamp-oil";
export const LAMP_OIL_NAME = "Lamp Oil";

/** The health lamp-oil restores, capped at maxHp. */
export const LAMP_OIL_HEAL = 30;

// ---- Weapon identities (specs/weapons.md, specs/evolutions.md) -----------

/** The ten base weapons, in this order. */
export const BASE_WEAPON_IDS = [
  "taper",
  "ember",
  "pin",
  "lantern",
  "halo",
  "oil-splash",
  "spark",
  "shard",
  "sconce",
  "flare",
] as const;

export type BaseWeaponId = (typeof BASE_WEAPON_IDS)[number];

/** The six evolved weapons, in this order. */
export const EVOLUTION_IDS = [
  "pyre",
  "beacon",
  "hail",
  "chandelier",
  "corona",
  "blaze",
] as const;

export type EvolutionId = (typeof EVOLUTION_IDS)[number];

export type WeaponId = BaseWeaponId | EvolutionId;

/** The display name of every weapon, base and evolved. */
export const WEAPON_NAMES: Readonly<Record<WeaponId, string>> = {
  taper: "Taper",
  ember: "Ember",
  pin: "Pin",
  lantern: "Lantern",
  halo: "Halo",
  "oil-splash": "Oil Splash",
  spark: "Spark",
  shard: "Shard",
  sconce: "Sconce",
  flare: "Flare",
  pyre: "Pyre",
  beacon: "Beacon",
  hail: "Hail",
  chandelier: "Chandelier",
  corona: "Corona",
  blaze: "Blaze",
};

/** The `pierce` value of a projectile that never dies from hits. */
export const INFINITE_PIERCE = -1;

// ---- Weapon level tables (specs/weapons.md) ------------------------------

/**
 * One row of a weapon's level table. Every weapon shares `damage` and
 * `cooldown`; the rest of a row is the shape its weapon needs, so each table
 * below is typed by one of the interfaces that follow. Row `i` is level
 * `i + 1`, and every table has MAX_WEAPON_LEVEL rows. Damage, cooldown, every
 * length, and amount pass through the derived stats above before use; speed
 * and duration are used as written.
 */
export interface WeaponLevelBase {
  readonly damage: number;
  /** Seconds between firings, before cooldownMul and MIN_COOLDOWN. */
  readonly cooldown: number;
}

/** Taper and Pyre: a rectangle that exists for one tick. */
export interface SlashLevel extends WeaponLevelBase {
  readonly width: number;
  readonly height: number;
  readonly amount: number;
}

/** Ember, Pin, Beacon, and Hail: a straight bolt with finite pierce. */
export interface BoltLevel extends WeaponLevelBase {
  readonly speed: number;
  readonly radius: number;
  readonly pierce: number;
  readonly duration: number;
  readonly amount: number;
}

/** Lantern: lanterns revolving around the lamplighter for a while. */
export interface OrbitLevel extends WeaponLevelBase {
  readonly orbit: number;
  readonly radius: number;
  readonly duration: number;
  readonly amount: number;
}

/**
 * Halo, Flare, and Corona: a circle centered on the lamplighter. For Halo and
 * Corona `cooldown` is the pulse interval of a permanent aura; for Flare it is
 * the interval between bursts.
 */
export interface RadialLevel extends WeaponLevelBase {
  readonly radius: number;
}

/** Oil Splash and Blaze: puddles that pulse for a while where they land. */
export interface PuddleLevel extends WeaponLevelBase {
  readonly radius: number;
  readonly duration: number;
  readonly amount: number;
}

/** Spark: strikes on enemies in range, each splashing over `area`. */
export interface StrikeLevel extends WeaponLevelBase {
  readonly area: number;
  readonly amount: number;
}

/**
 * Shard and Sconce: a bolt with INFINITE_PIERCE that damages each enemy at
 * most once per its weapon's re-hit interval.
 */
export interface PersistentBoltLevel extends WeaponLevelBase {
  readonly speed: number;
  readonly radius: number;
  readonly duration: number;
  readonly amount: number;
}

export const TAPER_LEVELS: readonly SlashLevel[] = [
  { damage: 10, cooldown: 1.35, width: 120, height: 40, amount: 1 },
  { damage: 15, cooldown: 1.35, width: 120, height: 40, amount: 1 },
  { damage: 15, cooldown: 1.35, width: 120, height: 40, amount: 2 },
  { damage: 15, cooldown: 1.35, width: 140, height: 48, amount: 2 },
  { damage: 20, cooldown: 1.35, width: 140, height: 48, amount: 2 },
  { damage: 20, cooldown: 1.2, width: 140, height: 48, amount: 2 },
  { damage: 25, cooldown: 1.2, width: 140, height: 48, amount: 2 },
  { damage: 30, cooldown: 1.2, width: 160, height: 56, amount: 2 },
];

/** A slash has two sides; amount beyond this adds nothing. */
export const TAPER_MAX_AMOUNT = 2;

/** Seconds a slash stays drawn; it hits on the tick it fires alone. */
export const SLASH_FLASH = 0.1;

export const EMBER_LEVELS: readonly BoltLevel[] = [
  {
    damage: 10,
    cooldown: 1.2,
    speed: 400,
    radius: 8,
    pierce: 0,
    duration: 2,
    amount: 1,
  },
  {
    damage: 10,
    cooldown: 1.2,
    speed: 400,
    radius: 8,
    pierce: 0,
    duration: 2,
    amount: 2,
  },
  {
    damage: 10,
    cooldown: 1,
    speed: 400,
    radius: 8,
    pierce: 0,
    duration: 2,
    amount: 2,
  },
  {
    damage: 15,
    cooldown: 1,
    speed: 400,
    radius: 8,
    pierce: 0,
    duration: 2,
    amount: 2,
  },
  {
    damage: 15,
    cooldown: 1,
    speed: 400,
    radius: 8,
    pierce: 1,
    duration: 2,
    amount: 2,
  },
  {
    damage: 15,
    cooldown: 1,
    speed: 400,
    radius: 8,
    pierce: 1,
    duration: 2,
    amount: 3,
  },
  {
    damage: 20,
    cooldown: 0.9,
    speed: 400,
    radius: 8,
    pierce: 1,
    duration: 2,
    amount: 3,
  },
  {
    damage: 25,
    cooldown: 0.8,
    speed: 450,
    radius: 10,
    pierce: 2,
    duration: 2,
    amount: 3,
  },
];

export const PIN_LEVELS: readonly BoltLevel[] = [
  {
    damage: 6,
    cooldown: 0.5,
    speed: 600,
    radius: 6,
    pierce: 1,
    duration: 1.5,
    amount: 1,
  },
  {
    damage: 6,
    cooldown: 0.5,
    speed: 600,
    radius: 6,
    pierce: 1,
    duration: 1.5,
    amount: 2,
  },
  {
    damage: 8,
    cooldown: 0.5,
    speed: 600,
    radius: 6,
    pierce: 1,
    duration: 1.5,
    amount: 2,
  },
  {
    damage: 8,
    cooldown: 0.5,
    speed: 600,
    radius: 6,
    pierce: 2,
    duration: 1.5,
    amount: 3,
  },
  {
    damage: 10,
    cooldown: 0.5,
    speed: 600,
    radius: 6,
    pierce: 2,
    duration: 1.5,
    amount: 3,
  },
  {
    damage: 10,
    cooldown: 0.4,
    speed: 600,
    radius: 6,
    pierce: 2,
    duration: 1.5,
    amount: 4,
  },
  {
    damage: 12,
    cooldown: 0.4,
    speed: 600,
    radius: 6,
    pierce: 3,
    duration: 1.5,
    amount: 4,
  },
  {
    damage: 15,
    cooldown: 0.35,
    speed: 700,
    radius: 7,
    pierce: 3,
    duration: 1.5,
    amount: 5,
  },
];

/**
 * Vertical spacing between darts fired together: dart `i` of `n` starts at
 * `player.y + (i - (n - 1) / 2) * PIN_SPREAD`. Hail uses the same spread.
 */
export const PIN_SPREAD = 10;

export const LANTERN_LEVELS: readonly OrbitLevel[] = [
  { damage: 10, cooldown: 3, orbit: 90, radius: 14, duration: 3, amount: 1 },
  { damage: 10, cooldown: 3, orbit: 90, radius: 14, duration: 3, amount: 2 },
  { damage: 15, cooldown: 3, orbit: 90, radius: 14, duration: 3, amount: 2 },
  { damage: 15, cooldown: 3, orbit: 100, radius: 16, duration: 3.5, amount: 2 },
  { damage: 15, cooldown: 3, orbit: 100, radius: 16, duration: 3.5, amount: 3 },
  {
    damage: 20,
    cooldown: 2.5,
    orbit: 100,
    radius: 16,
    duration: 3.5,
    amount: 3,
  },
  { damage: 20, cooldown: 2.5, orbit: 110, radius: 18, duration: 4, amount: 3 },
  { damage: 25, cooldown: 2.5, orbit: 120, radius: 20, duration: 4, amount: 4 },
];

/** How fast lanterns revolve, in degrees per second, clockwise on screen. */
export const LANTERN_ANGULAR_SPEED = 180;

/** Seconds between hits by one lantern on one enemy. Chandelier shares it. */
export const LANTERN_REHIT = 0.5;

export const HALO_LEVELS: readonly RadialLevel[] = [
  { damage: 3, cooldown: 1, radius: 80 },
  { damage: 3, cooldown: 1, radius: 90 },
  { damage: 4, cooldown: 1, radius: 90 },
  { damage: 4, cooldown: 0.8, radius: 100 },
  { damage: 5, cooldown: 0.8, radius: 100 },
  { damage: 5, cooldown: 0.8, radius: 110 },
  { damage: 6, cooldown: 0.7, radius: 110 },
  { damage: 8, cooldown: 0.6, radius: 120 },
];

export const OIL_SPLASH_LEVELS: readonly PuddleLevel[] = [
  { damage: 4, cooldown: 3, radius: 50, duration: 2.5, amount: 1 },
  { damage: 4, cooldown: 3, radius: 50, duration: 2.5, amount: 2 },
  { damage: 5, cooldown: 3, radius: 55, duration: 2.5, amount: 2 },
  { damage: 5, cooldown: 2.5, radius: 55, duration: 3, amount: 2 },
  { damage: 6, cooldown: 2.5, radius: 60, duration: 3, amount: 3 },
  { damage: 6, cooldown: 2.5, radius: 60, duration: 3.5, amount: 3 },
  { damage: 7, cooldown: 2, radius: 65, duration: 3.5, amount: 3 },
  { damage: 8, cooldown: 2, radius: 70, duration: 4, amount: 4 },
];

/** A puddle lands at a uniformly random point within this distance. */
export const OIL_SCATTER = 400;

/** Seconds between a puddle's pulses. */
export const OIL_PULSE = 0.3;

export const SPARK_LEVELS: readonly StrikeLevel[] = [
  { damage: 15, cooldown: 2, area: 40, amount: 1 },
  { damage: 15, cooldown: 2, area: 40, amount: 2 },
  { damage: 20, cooldown: 2, area: 40, amount: 2 },
  { damage: 20, cooldown: 1.8, area: 50, amount: 2 },
  { damage: 25, cooldown: 1.8, area: 50, amount: 3 },
  { damage: 25, cooldown: 1.6, area: 50, amount: 3 },
  { damage: 30, cooldown: 1.6, area: 60, amount: 3 },
  { damage: 40, cooldown: 1.4, area: 70, amount: 4 },
];

/** A strike picks its target among enemies within this distance. */
export const SPARK_RANGE = 600;

/** Seconds a strike stays drawn; it has no hitbox after landing. */
export const SPARK_FLASH = 0.2;

export const SHARD_LEVELS: readonly PersistentBoltLevel[] = [
  { damage: 8, cooldown: 2.5, speed: 500, radius: 8, duration: 3, amount: 1 },
  { damage: 8, cooldown: 2.5, speed: 500, radius: 8, duration: 3.5, amount: 1 },
  {
    damage: 10,
    cooldown: 2.5,
    speed: 500,
    radius: 8,
    duration: 3.5,
    amount: 2,
  },
  { damage: 10, cooldown: 2.2, speed: 500, radius: 8, duration: 4, amount: 2 },
  { damage: 12, cooldown: 2.2, speed: 500, radius: 8, duration: 4, amount: 2 },
  { damage: 12, cooldown: 2, speed: 550, radius: 9, duration: 4.5, amount: 3 },
  { damage: 15, cooldown: 2, speed: 550, radius: 9, duration: 4.5, amount: 3 },
  { damage: 20, cooldown: 1.8, speed: 600, radius: 10, duration: 5, amount: 3 },
];

/** Seconds between hits by one shard on one enemy. */
export const SHARD_REHIT = 0.5;

/** Degrees between the directions of shards fired together. */
export const SHARD_SPREAD = 15;

export const SCONCE_LEVELS: readonly PersistentBoltLevel[] = [
  { damage: 12, cooldown: 2, speed: 600, radius: 12, duration: 2.5, amount: 1 },
  { damage: 12, cooldown: 2, speed: 600, radius: 12, duration: 2.5, amount: 2 },
  { damage: 16, cooldown: 2, speed: 600, radius: 12, duration: 2.5, amount: 2 },
  {
    damage: 16,
    cooldown: 1.8,
    speed: 600,
    radius: 14,
    duration: 2.5,
    amount: 2,
  },
  {
    damage: 20,
    cooldown: 1.8,
    speed: 600,
    radius: 14,
    duration: 2.5,
    amount: 3,
  },
  {
    damage: 20,
    cooldown: 1.6,
    speed: 600,
    radius: 14,
    duration: 2.5,
    amount: 3,
  },
  {
    damage: 24,
    cooldown: 1.6,
    speed: 600,
    radius: 16,
    duration: 2.5,
    amount: 3,
  },
  {
    damage: 30,
    cooldown: 1.4,
    speed: 600,
    radius: 16,
    duration: 2.5,
    amount: 4,
  },
];

/** A sconce's deceleration along its launch direction, in units/second². */
export const SCONCE_DECEL = 600;

/** Seconds between hits by one sconce on one enemy. */
export const SCONCE_REHIT = 0.5;

/** Degrees between the directions of sconces launched together. */
export const SCONCE_SPREAD = 20;

export const FLARE_LEVELS: readonly RadialLevel[] = [
  { damage: 100, cooldown: 60, radius: 640 },
  { damage: 100, cooldown: 55, radius: 640 },
  { damage: 150, cooldown: 55, radius: 640 },
  { damage: 150, cooldown: 50, radius: 640 },
  { damage: 200, cooldown: 50, radius: 640 },
  { damage: 200, cooldown: 45, radius: 640 },
  { damage: 300, cooldown: 45, radius: 640 },
  { damage: 500, cooldown: 40, radius: 640 },
];

/** Seconds a flare's burst stays drawn. */
export const FLARE_FLASH = 0.4;

/** Every base weapon's level table, by id, each keeping its row shape. */
export interface WeaponLevelTables {
  readonly taper: readonly SlashLevel[];
  readonly ember: readonly BoltLevel[];
  readonly pin: readonly BoltLevel[];
  readonly lantern: readonly OrbitLevel[];
  readonly halo: readonly RadialLevel[];
  readonly "oil-splash": readonly PuddleLevel[];
  readonly spark: readonly StrikeLevel[];
  readonly shard: readonly PersistentBoltLevel[];
  readonly sconce: readonly PersistentBoltLevel[];
  readonly flare: readonly RadialLevel[];
}

export const WEAPON_LEVELS: WeaponLevelTables = {
  taper: TAPER_LEVELS,
  ember: EMBER_LEVELS,
  pin: PIN_LEVELS,
  lantern: LANTERN_LEVELS,
  halo: HALO_LEVELS,
  "oil-splash": OIL_SPLASH_LEVELS,
  spark: SPARK_LEVELS,
  shard: SHARD_LEVELS,
  sconce: SCONCE_LEVELS,
  flare: FLARE_LEVELS,
};

// ---- Passives (specs/passives.md) ----------------------------------------

/** The ten passives, in this order. */
export const PASSIVE_IDS = [
  "wick",
  "oil",
  "glass",
  "brass",
  "mirror",
  "bellows",
  "tallow",
  "tinder",
  "soot",
  "lure",
] as const;

export type PassiveId = (typeof PASSIVE_IDS)[number];

export interface Passive {
  readonly name: string;
  /** The level past which the passive is no longer offered. */
  readonly maxLevel: number;
}

export const PASSIVES: Readonly<Record<PassiveId, Passive>> = {
  wick: { name: "Wick", maxLevel: 5 },
  oil: { name: "Oil", maxLevel: 5 },
  glass: { name: "Glass", maxLevel: 5 },
  brass: { name: "Brass", maxLevel: 3 },
  mirror: { name: "Mirror", maxLevel: 2 },
  bellows: { name: "Bellows", maxLevel: 5 },
  tallow: { name: "Tallow", maxLevel: 5 },
  tinder: { name: "Tinder", maxLevel: 5 },
  soot: { name: "Soot", maxLevel: 5 },
  lure: { name: "Lure", maxLevel: 5 },
};

/** Everything a level-up overlay can offer. */
export type OfferId = WeaponId | PassiveId | typeof LAMP_OIL_ID;

// ---- Evolutions (specs/evolutions.md) ------------------------------------

export interface Evolution {
  /** The base weapon that evolves, held at MAX_WEAPON_LEVEL. */
  readonly from: BaseWeaponId;
  /** The passive that must be held, at any level. */
  readonly passive: PassiveId;
}

/** Each recipe, by the evolved weapon's id. */
export const EVOLUTIONS: Readonly<Record<EvolutionId, Evolution>> = {
  pyre: { from: "taper", passive: "wick" },
  beacon: { from: "ember", passive: "oil" },
  hail: { from: "pin", passive: "mirror" },
  chandelier: { from: "lantern", passive: "glass" },
  corona: { from: "halo", passive: "tinder" },
  blaze: { from: "oil-splash", passive: "soot" },
};

/**
 * An evolved weapon has a single level, so its stats are one row rather than a
 * table. The derived stats still apply to them exactly as to a base weapon.
 */
export const PYRE_STATS: SlashLevel = {
  damage: 60,
  cooldown: 1.2,
  width: 200,
  height: 60,
  amount: 2,
};

/** Health restored to the lamplighter per enemy a Pyre slash hits. */
export const PYRE_HEAL = 1;

export const BEACON_STATS: BoltLevel = {
  damage: 20,
  cooldown: 0.25,
  speed: 500,
  radius: 10,
  pierce: 2,
  duration: 2,
  amount: 1,
};

export const HAIL_STATS: BoltLevel = {
  damage: 15,
  cooldown: 0.5,
  speed: 700,
  radius: 7,
  pierce: 3,
  duration: 1.5,
  amount: 6,
};

/** Chandelier's lanterns never vanish: it has no cooldown and no duration. */
export interface PermanentOrbit {
  readonly damage: number;
  readonly orbit: number;
  readonly radius: number;
  readonly amount: number;
}

export const CHANDELIER_STATS: PermanentOrbit = {
  damage: 25,
  orbit: 120,
  radius: 20,
  amount: 4,
};

export const CORONA_STATS: RadialLevel = {
  damage: 12,
  cooldown: 0.5,
  radius: 150,
};

/** Health restored to the lamplighter per enemy a Corona pulse kills. */
export const CORONA_HEAL = 1;

export const BLAZE_STATS: PuddleLevel = {
  damage: 8,
  cooldown: 2,
  radius: 70,
  duration: 4,
  amount: 5,
};

/** Seconds between a Blaze puddle's pulses. */
export const BLAZE_PULSE = 0.2;

// ---- Gems (specs/world.md) -----------------------------------------------

export const GEM_TIERS = ["small", "medium", "large"] as const;

export type GemTier = (typeof GEM_TIERS)[number];

/** The xp each tier grants, before xpMul. */
export const GEM_VALUES: Readonly<Record<GemTier, number>> = {
  small: 1,
  medium: 3,
  large: 10,
};

// ---- Enemies (specs/enemies.md) ------------------------------------------

export const ENEMY_IDS = [
  "moth",
  "bat",
  "rat",
  "gnat",
  "beetle",
  "wisp",
  "spider",
  "crow",
  "shade",
  "hound",
  "mothwing",
  "owl",
  "dark",
] as const;

export type EnemyId = (typeof ENEMY_IDS)[number];

/**
 * `chase` re-aims at the lamplighter every tick; `drift` keeps the heading it
 * spawned with; `weave` chases with a perpendicular sine offset.
 */
export type EnemyBehavior = "chase" | "drift" | "weave";

/**
 * `common` enemies are scaled by HP_SCALE_PER_MINUTE and despawn by distance,
 * and all but gnats count toward the spawn cap. Elites and the Dark do none of
 * those.
 */
export type EnemyRank = "common" | "elite" | "dark";

export interface Enemy {
  readonly name: string;
  readonly rank: EnemyRank;
  readonly hp: number;
  /** Units per second. */
  readonly speed: number;
  /** Contact damage per hit, before armor. */
  readonly damage: number;
  readonly radius: number;
  /** What its death leaves at its position. */
  readonly drop: GemTier | "chest" | null;
  readonly behavior: EnemyBehavior;
}

export const ENEMIES: Readonly<Record<EnemyId, Enemy>> = {
  moth: {
    name: "Moth",
    rank: "common",
    hp: 5,
    speed: 100,
    damage: 5,
    radius: 10,
    drop: "small",
    behavior: "chase",
  },
  bat: {
    name: "Bat",
    rank: "common",
    hp: 8,
    speed: 140,
    damage: 5,
    radius: 10,
    drop: "small",
    behavior: "chase",
  },
  rat: {
    name: "Rat",
    rank: "common",
    hp: 15,
    speed: 120,
    damage: 8,
    radius: 12,
    drop: "small",
    behavior: "chase",
  },
  gnat: {
    name: "Gnat",
    rank: "common",
    hp: 2,
    speed: 160,
    damage: 3,
    radius: 8,
    drop: "small",
    behavior: "drift",
  },
  beetle: {
    name: "Beetle",
    rank: "common",
    hp: 25,
    speed: 60,
    damage: 10,
    radius: 14,
    drop: "medium",
    behavior: "chase",
  },
  wisp: {
    name: "Wisp",
    rank: "common",
    hp: 12,
    speed: 90,
    damage: 6,
    radius: 10,
    drop: "medium",
    behavior: "weave",
  },
  spider: {
    name: "Spider",
    rank: "common",
    hp: 40,
    speed: 80,
    damage: 12,
    radius: 14,
    drop: "medium",
    behavior: "chase",
  },
  crow: {
    name: "Crow",
    rank: "common",
    hp: 30,
    speed: 150,
    damage: 10,
    radius: 12,
    drop: "medium",
    behavior: "chase",
  },
  shade: {
    name: "Shade",
    rank: "common",
    hp: 60,
    speed: 70,
    damage: 15,
    radius: 16,
    drop: "medium",
    behavior: "chase",
  },
  hound: {
    name: "Hound",
    rank: "common",
    hp: 120,
    speed: 110,
    damage: 20,
    radius: 18,
    drop: "large",
    behavior: "chase",
  },
  mothwing: {
    name: "Mothwing",
    rank: "elite",
    hp: 600,
    speed: 90,
    damage: 20,
    radius: 28,
    drop: "chest",
    behavior: "chase",
  },
  owl: {
    name: "Owl",
    rank: "elite",
    hp: 2000,
    speed: 100,
    damage: 30,
    radius: 36,
    drop: "chest",
    behavior: "chase",
  },
  dark: {
    name: "The Dark",
    rank: "dark",
    hp: 10000,
    speed: 170,
    damage: 50,
    radius: 40,
    drop: null,
    behavior: "chase",
  },
};

/** Enemies a Flare burst leaves untouched. */
export const FLARE_IMMUNE: readonly EnemyId[] = ["dark"];

/**
 * A common enemy spawns with
 * `maxHp = hp * (1 + HP_SCALE_PER_MINUTE * floor(time / 60))`.
 */
export const HP_SCALE_PER_MINUTE = 0.15;

/**
 * A weaving enemy sits at its anchor plus a perpendicular offset of
 * `WISP_AMPLITUDE * sin(2π * age / WISP_PERIOD)`, in units and seconds.
 */
export const WISP_AMPLITUDE = 40;
export const WISP_PERIOD = 1;

// ---- Spawn director (specs/enemies.md) -----------------------------------

/** How far from the lamplighter an enemy spawns, at a random angle. */
export const SPAWN_DISTANCE = 760;

/** A common enemy farther than this from the lamplighter is removed. */
export const DESPAWN_DISTANCE = 1200;

/** Seconds per spawn window; the index is `min(19, floor(time / SPAWN_WINDOW))`. */
export const SPAWN_WINDOW = 30;

export interface SpawnWindow {
  /** The types a spawn chooses from, uniformly. */
  readonly types: readonly EnemyId[];
  /** Seconds between spawns. */
  readonly interval: number;
  /**
   * The most common enemies other than gnats alive for the director to spawn
   * another.
   */
  readonly cap: number;
}

/** One row per window, in window order, covering the whole night. */
export const SPAWN_WINDOWS: readonly SpawnWindow[] = [
  { types: ["moth"], interval: 1, cap: 20 },
  { types: ["moth", "bat"], interval: 0.8, cap: 30 },
  { types: ["moth", "bat", "rat"], interval: 0.6, cap: 40 },
  { types: ["bat", "rat", "beetle"], interval: 0.5, cap: 50 },
  { types: ["bat", "rat", "beetle"], interval: 0.5, cap: 60 },
  { types: ["rat", "beetle", "wisp"], interval: 0.4, cap: 70 },
  { types: ["beetle", "wisp", "spider"], interval: 0.4, cap: 80 },
  { types: ["wisp", "spider", "crow"], interval: 0.35, cap: 90 },
  { types: ["spider", "crow", "shade"], interval: 0.3, cap: 100 },
  { types: ["crow", "shade", "moth"], interval: 0.3, cap: 110 },
  { types: ["shade", "crow", "hound"], interval: 0.25, cap: 120 },
  { types: ["bat", "shade", "hound"], interval: 0.25, cap: 130 },
  { types: ["rat", "spider", "hound"], interval: 0.2, cap: 140 },
  { types: ["beetle", "crow", "hound"], interval: 0.2, cap: 150 },
  { types: ["wisp", "shade", "hound"], interval: 0.2, cap: 160 },
  { types: ["spider", "crow", "hound"], interval: 0.15, cap: 170 },
  { types: ["crow", "shade", "hound"], interval: 0.15, cap: 180 },
  { types: ["shade", "hound", "bat"], interval: 0.15, cap: 190 },
  { types: ["shade", "hound", "crow"], interval: 0.1, cap: 200 },
  { types: ["hound", "shade", "spider"], interval: 0.1, cap: 200 },
];

/** How many gnats a swarm spawns at once, outside the cap. */
export const SWARM_SIZE = 24;

/**
 * The length of the line a swarm spawns along, centered SPAWN_DISTANCE from
 * the lamplighter and perpendicular to the direction it arrives from.
 */
export const SWARM_LINE = 720;

export interface ScriptedEvent {
  /** The run clock, in seconds, at which the event fires, once per run. */
  readonly time: number;
  /** `swarm` spawns SWARM_SIZE of `type`; `spawn` spawns one on the ring. */
  readonly kind: "swarm" | "spawn";
  readonly type: EnemyId;
}

/** The night's scripted spawns, in time order. */
export const EVENTS: readonly ScriptedEvent[] = [
  { time: 60, kind: "swarm", type: "gnat" },
  { time: 120, kind: "spawn", type: "mothwing" },
  { time: 240, kind: "swarm", type: "gnat" },
  { time: 300, kind: "spawn", type: "mothwing" },
  { time: 420, kind: "swarm", type: "gnat" },
  { time: 450, kind: "spawn", type: "owl" },
  { time: 540, kind: "spawn", type: "dark" },
];

// ---- Pickups (specs/world.md) --------------------------------------------

export const PICKUP_KINDS = ["chest", "bread", "draft"] as const;

export type PickupKind = (typeof PICKUP_KINDS)[number];

/** A pickup is collected within `PICKUP_ITEM_RADIUS + PLAYER_RADIUS`. */
export const PICKUP_ITEM_RADIUS = 16;

/** Health bread restores, capped at maxHp. */
export const BREAD_HEAL = 30;

/** Probability a common kill drops bread, drawn first. */
export const BREAD_CHANCE = 0.02;

/** Probability a common kill drops a draft, drawn only when bread did not. */
export const DRAFT_CHANCE = 0.005;

/** Health a chest restores when nothing evolves and nothing can level. */
export const CHEST_HEAL = 30;

// ---- Screen copy (specs/ui.md) -------------------------------------------

export const TITLE_TEXT = "WICK";
export const TAGLINE_TEXT = "KEEP THE LIGHT";

/** The title menu, in this order. */
export const TITLE_ITEMS = ["LIGHT THE LAMP", "HOW TO PLAY"] as const;

/** The level-up overlay's heading. */
export const LEVEL_UP_TEXT = "THE LAMP BURNS BRIGHTER";

/** The chest overlay's heading. */
export const CHEST_TEXT = "A CHEST OPENS";

export const PAUSED_TEXT = "PAUSED";

/** The two end screens' headings. */
export const FALLEN_TEXT = "THE LIGHT WENT OUT";
export const DAWN_TEXT = "DAWN";

/** The end screens' menu, in this order. */
export const END_ITEMS = ["TRY AGAIN", "TITLE"] as const;

/** An offer's tag: `NEW` for an item not yet held, else `LEVEL n`. */
export const OFFER_NEW_TEXT = "NEW";

/** The word before a level number, on offers and on the HUD. */
export const LEVEL_LABEL = "LEVEL";

// ---- Input actions (specs/controls.md) -----------------------------------

/** The lamplighter only moves, so a four-way pad carries the whole game. */
export const LAYOUT = "dpad-4";

/**
 * Every action Wick registers: the layout's four movement actions, read as
 * held values on `playing`, and the menu vocabulary, read as press edges.
 */
export const ACTIONS = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "back",
  "pause",
  "mute",
] as const;

export type ActionName = (typeof ACTIONS)[number];

/**
 * The keys each action is bound to, as `KeyboardEvent.code` values so a binding
 * is a physical key rather than a layout-dependent character.
 */
export const BINDINGS: Readonly<Record<ActionName, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

// ---- Audio cues (specs/ui.md) --------------------------------------------

/** The fifteen cue names, one per event. Define and play exactly these. */
export const CUES = {
  hit: "hit",
  kill: "kill",
  gem: "gem",
  hurt: "hurt",
  levelUp: "level-up",
  choose: "choose",
  chest: "chest",
  evolve: "evolve",
  pickup: "pickup",
  fallen: "fallen",
  dawn: "dawn",
  menuMove: "menu-move",
  menuConfirm: "menu-confirm",
  music: "music",
  hum: "hum",
} as const;

export type CueName = (typeof CUES)[keyof typeof CUES];

/**
 * The cues that loop until stopped rather than playing once: the music bed
 * for the length of a run, and the hum while Halo or Corona is held.
 */
export const LOOPING_CUES: readonly CueName[] = [CUES.music, CUES.hum];

// ---- The produced assets (specs/assets.md) -------------------------------
//
// Every produced file this build loads, as a path under `assets/` at the root
// of this repository. The files do not exist yet: this build produces them with
// the asset tools on the `PATH` and commits them there. Every canvas size is in
// pixels, and a sprite is drawn at one unit per pixel, so a canvas `24` wide
// stands `24` units wide in the world.

/** Seconds each frame of a walk cycle or a spin is shown. */
export const WALK_FRAME_TIME = 0.1;

/** Seconds a death puff lasts, all of its frames together. */
export const PUFF_TIME = 0.4;

/**
 * A sheet whose frames are separate files: frame `i`, counted from `0`, is
 * `<dir>/<i>.png`, each on a canvas of the sheet's size.
 */
export interface SpriteSheet {
  readonly dir: string;
  readonly frames: number;
}

/** The lamplighter's canvas, idle and walking. */
export const LAMPLIGHTER_SPRITE_WIDTH = 24;
export const LAMPLIGHTER_SPRITE_HEIGHT = 32;

/** The idle lamplighter, one sprite. */
export const LAMPLIGHTER_IDLE_PATH = "sprites/lamplighter/idle.png";

/** The lamplighter's walk cycle. */
export const LAMPLIGHTER_WALK_SHEET: SpriteSheet = {
  dir: "sprites/lamplighter/walk",
  frames: 6,
};

/**
 * Each enemy's walk cycle is the sheet `sprites/enemies/<id>`, ENEMY_FRAMES
 * frames on a square canvas twice the enemy's radius in ENEMIES.
 */
export const ENEMY_SHEET_DIR = "sprites/enemies";
export const ENEMY_FRAMES = 4;

/** The death puff every enemy shares, on a square canvas of PUFF_SPRITE_SIZE. */
export const PUFF_SHEET: SpriteSheet = { dir: "sprites/puff", frames: 4 };
export const PUFF_SPRITE_SIZE = 24;

/** The three gems, each one sprite on a square canvas of its size. */
export const GEM_PATHS: Readonly<Record<GemTier, string>> = {
  small: "sprites/gems/small.png",
  medium: "sprites/gems/medium.png",
  large: "sprites/gems/large.png",
};

export const GEM_SPRITE_SIZES: Readonly<Record<GemTier, number>> = {
  small: 8,
  medium: 12,
  large: 16,
};

/** The three pickups, each one sprite on a square canvas of PICKUP_SPRITE_SIZE. */
export const PICKUP_PATHS: Readonly<Record<PickupKind, string>> = {
  chest: "sprites/pickups/chest.png",
  bread: "sprites/pickups/bread.png",
  draft: "sprites/pickups/draft.png",
};

export const PICKUP_SPRITE_SIZE = 24;

/** The ground tile, repeated across the world, on a square canvas of its size. */
export const GROUND_TILE_PATH = "sprites/ground.png";
export const GROUND_TILE_SIZE = 64;

/**
 * One weapon's effect, drawn over the weapon's live shape and scaled in code to
 * it. A single sprite has `frames` `1` and `path` names its file; a sheet has
 * `frames` above `1` and `path` names its directory, frame `i` at
 * `<path>/<i>.png`. `width` and `height` are the canvas the file is produced on.
 */
export interface EffectSprite {
  readonly path: string;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
}

/** The sixteen weapon effects, an evolved weapon's on its base's canvas. */
export const EFFECT_SPRITES: Readonly<Record<WeaponId, EffectSprite>> = {
  taper: {
    path: "sprites/effects/taper.png",
    frames: 1,
    width: 120,
    height: 40,
  },
  ember: {
    path: "sprites/effects/ember.png",
    frames: 1,
    width: 16,
    height: 16,
  },
  pin: { path: "sprites/effects/pin.png", frames: 1, width: 12, height: 12 },
  lantern: {
    path: "sprites/effects/lantern.png",
    frames: 1,
    width: 28,
    height: 28,
  },
  halo: {
    path: "sprites/effects/halo.png",
    frames: 1,
    width: 160,
    height: 160,
  },
  "oil-splash": {
    path: "sprites/effects/oil-splash.png",
    frames: 1,
    width: 100,
    height: 100,
  },
  spark: { path: "sprites/effects/spark", frames: 4, width: 80, height: 80 },
  shard: {
    path: "sprites/effects/shard.png",
    frames: 1,
    width: 16,
    height: 16,
  },
  sconce: { path: "sprites/effects/sconce", frames: 4, width: 24, height: 24 },
  flare: { path: "sprites/effects/flare", frames: 6, width: 128, height: 128 },
  pyre: { path: "sprites/effects/pyre.png", frames: 1, width: 120, height: 40 },
  beacon: {
    path: "sprites/effects/beacon.png",
    frames: 1,
    width: 16,
    height: 16,
  },
  hail: { path: "sprites/effects/hail.png", frames: 1, width: 12, height: 12 },
  chandelier: {
    path: "sprites/effects/chandelier.png",
    frames: 1,
    width: 28,
    height: 28,
  },
  corona: {
    path: "sprites/effects/corona.png",
    frames: 1,
    width: 160,
    height: 160,
  },
  blaze: {
    path: "sprites/effects/blaze.png",
    frames: 1,
    width: 100,
    height: 100,
  },
};

/** The twenty-seven icons, each one sprite on a square canvas of ICON_SIZE. */
export const ICON_PATHS: Readonly<Record<OfferId, string>> = {
  taper: "icons/taper.png",
  ember: "icons/ember.png",
  pin: "icons/pin.png",
  lantern: "icons/lantern.png",
  halo: "icons/halo.png",
  "oil-splash": "icons/oil-splash.png",
  spark: "icons/spark.png",
  shard: "icons/shard.png",
  sconce: "icons/sconce.png",
  flare: "icons/flare.png",
  pyre: "icons/pyre.png",
  beacon: "icons/beacon.png",
  hail: "icons/hail.png",
  chandelier: "icons/chandelier.png",
  corona: "icons/corona.png",
  blaze: "icons/blaze.png",
  wick: "icons/wick.png",
  oil: "icons/oil.png",
  glass: "icons/glass.png",
  brass: "icons/brass.png",
  mirror: "icons/mirror.png",
  bellows: "icons/bellows.png",
  tallow: "icons/tallow.png",
  tinder: "icons/tinder.png",
  soot: "icons/soot.png",
  lure: "icons/lure.png",
  "lamp-oil": "icons/lamp-oil.png",
};

export const ICON_SIZE = 24;

/** The one produced file per cue name, the music bed included. */
export const CUE_PATHS: Readonly<Record<CueName, string>> = {
  hit: "audio/hit.wav",
  kill: "audio/kill.wav",
  gem: "audio/gem.wav",
  hurt: "audio/hurt.wav",
  "level-up": "audio/level-up.wav",
  choose: "audio/choose.wav",
  chest: "audio/chest.wav",
  evolve: "audio/evolve.wav",
  pickup: "audio/pickup.wav",
  fallen: "audio/fallen.wav",
  dawn: "audio/dawn.wav",
  "menu-move": "audio/menu-move.wav",
  "menu-confirm": "audio/menu-confirm.wav",
  music: "audio/music.wav",
  hum: "audio/hum.wav",
};

/** The music bed's score, committed beside its `.wav`. */
export const MUSIC_SCORE_PATH = "audio/music.mid";

/** The least the music bed runs, in seconds. */
export const MUSIC_MIN_SECONDS = 30;

/** The least the hum loop runs, in seconds. */
export const HUM_MIN_SECONDS = 2;

/**
 * A file authored to loop, `hum` and `music`, has its last and first samples
 * within this fraction of full scale of each other in every channel.
 */
export const LOOP_SEAM_TOLERANCE = 0.01;

// ---- Debug surface (specs/instrumentation.md) ----------------------------

/** The version the debug surface reports as `version`. */
export const WICK_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;
