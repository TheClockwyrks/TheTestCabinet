// Wick — the figures the specification fixes, as this suite states them.
// CASE-PROVIDED.
//
// Every value here is DERIVED FROM THE RENDERED SPECS, file and statement
// named beside each group, and none is imported from the build. The seeded
// `src/constants.ts` carries the same figures for the build's own use; this
// file restates them so a check's bound traces to the specification rather
// than to anything the workspace holds, and so a build that edited its
// constants would still be graded against the spec.
//
// Every length is in world units (the stage's units), every rate is PER
// SECOND, every duration is in SECONDS, and a count of ticks is stated as one.
// The tolerances at the end are the suite's own, each with the reason it is
// honest.

/* ---- The stage and the tick (specs/overview.md, specs/world.md) --------- */

/** The fixed logical stage, 16:9. */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The stage center, where the lamplighter is always drawn. */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

/** Ticks per second of game time. */
export const TICK_HZ = 60;

/** One tick, in seconds. The simulation advances only in whole ticks. */
export const TICK_DT = 1 / 60;

/**
 * One tick, in milliseconds: the delta the harness's clock supplies each frame
 * by default, so one frame on `playing` consumes exactly one tick
 * (`specs/instrumentation.md`, "What the runtime provides instead").
 */
export const TICK_MS = 1000 / 60;

/** A tick is consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`. */
export const TICK_EPSILON = 1e-9;

/** The length of the night, in seconds; the run ends at dawn on tick 36000. */
export const DAWN_TIME = 600;

/** The tick dawn arrives on: `DAWN_TIME × TICK_HZ`. */
export const DAWN_TICK = DAWN_TIME * TICK_HZ;

/** The last tick `setTick` accepts: `DAWN_TIME × TICK_HZ − 1`. */
export const LAST_TICK = DAWN_TICK - 1;

/** An interval of `seconds` anywhere in the specification, in whole ticks. */
export function ticksOf(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/* ---- The lamplighter (specs/world.md) ----------------------------------- */

export const MOVE_SPEED = 180;
export const PLAYER_RADIUS = 12;
export const BASE_MAX_HP = 100;
export const BASE_RECOVERY = 0;
export const PICKUP_RADIUS = 48;

/** Contact damage: seconds between hits by one enemy, and the least a hit removes. */
export const CONTACT_COOLDOWN = 0.5;
export const MIN_DAMAGE_TAKEN = 1;

/**
 * Seconds the hurt flash runs after a contact hit: `specs/world.md`, Contact
 * damage, "Seconds the hurt flash runs | `HURT_FLASH` | `0.3`". The timer is
 * set to this on every tick a contact hit lands and counts down with the
 * contact cooldowns in phase 7.
 */
export const HURT_FLASH = 0.3;

/**
 * Ticks a flash covers, `round(HURT_FLASH × TICK_HZ)` (18): the count after
 * which `hurtFlash` has reached `0`, derived from the figure above and the
 * tick rate rather than measured off a build.
 */
export const HURT_FLASH_TICKS = Math.round(HURT_FLASH * TICK_HZ);

/* ---- Gems and pickups (specs/world.md) ---------------------------------- */

export const GEM_TIERS = ["small", "medium", "large"] as const;
export type GemTier = (typeof GEM_TIERS)[number];

/** The experience each tier grants before `xpMul`. */
export const GEM_VALUES: Readonly<Record<GemTier, number>> = {
  small: 1,
  medium: 3,
  large: 10,
};

/** Flight speed of an attracted gem, and the distance it is collected within. */
export const GEM_SPEED = 600;
export const COLLECT_RADIUS = 8;

/** Each tier's display name, which the almanac draws (`specs/ui.md`, `almanac`). */
export const GEM_NAMES: Readonly<Record<GemTier, string>> = {
  small: "Small Gem",
  medium: "Medium Gem",
  large: "Large Gem",
};

/** Each tier's line, character for character (`specs/ui.md`, Descriptions). */
export const GEM_DESCRIPTIONS: Readonly<Record<GemTier, string>> = {
  small: "The experience a common death leaves behind.",
  medium: "A heavier gem, worth more toward the next level.",
  large: "The heaviest gem, left by the heaviest of the dark.",
};

export const PICKUP_KINDS = ["chest", "bread", "draft"] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];

/** A pickup is collected within `PICKUP_ITEM_RADIUS + PLAYER_RADIUS`, at every Lure level. */
export const PICKUP_ITEM_RADIUS = 16;

/** Each kind's display name, which the almanac draws (`specs/ui.md`, `almanac`). */
export const PICKUP_NAMES: Readonly<Record<PickupKind, string>> = {
  chest: "Chest",
  bread: "Bread",
  draft: "Draft",
};

/** Each kind's line, character for character (`specs/ui.md`, Descriptions). */
export const PICKUP_DESCRIPTIONS: Readonly<Record<PickupKind, string>> = {
  chest: "Opens beside the lamp and transforms a tool at its top level.",
  bread: "Restores 30 health to the lamplighter who walks over it.",
  draft: "Draws every gem in the night to the lamp at once.",
};

export const BREAD_HEAL = 30;
export const BREAD_CHANCE = 0.02;
export const DRAFT_CHANCE = 0.005;

/* ---- Passives and derived stats (specs/passives.md) --------------------- */

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
  name: string;
  maxLevel: number;
}

/** Each passive's display name and max level, in `PASSIVE_IDS` order. */
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

/** Each passive's line, character for character (`specs/ui.md`, Descriptions). */
export const PASSIVE_DESCRIPTIONS: Readonly<Record<PassiveId, string>> = {
  wick: "Every tool you carry does more damage.",
  oil: "Every tool you carry fires more often.",
  glass: "Every shape your tools make covers more ground.",
  brass: "Armor: every hit against you takes less health.",
  mirror: "Your tools make one more of whatever they make.",
  bellows: "The lamplighter walks faster.",
  tallow: "The lamp holds more health.",
  tinder: "The lamp recovers health as the night goes on.",
  soot: "Gems are worth more experience.",
  lure: "Gems are drawn to the lamp from further away.",
};

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

/** A cooldown is `max(MIN_COOLDOWN, table cooldown × cooldownMul)`. */
export const MIN_COOLDOWN = 0.2;

/** The derived stats, each a single formula over the levels held. */
export const damageMul = (wick: number): number =>
  1 + WICK_DAMAGE_PER_LEVEL * wick;
export const cooldownMul = (oil: number): number =>
  1 - OIL_COOLDOWN_PER_LEVEL * oil;
export const areaMul = (glass: number): number =>
  1 + GLASS_AREA_PER_LEVEL * glass;
export const armorOf = (brass: number): number => BRASS_ARMOR_PER_LEVEL * brass;
export const amountBonus = (mirror: number): number =>
  MIRROR_AMOUNT_PER_LEVEL * mirror;
export const speedMul = (bellows: number): number =>
  1 + BELLOWS_SPEED_PER_LEVEL * bellows;
export const maxHpOf = (tallow: number): number =>
  BASE_MAX_HP + TALLOW_HP_PER_LEVEL * tallow;
export const recoveryOf = (tinder: number): number =>
  BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL * tinder;
export const xpMul = (soot: number): number => 1 + SOOT_XP_PER_LEVEL * soot;
export const pickupMul = (lure: number): number =>
  1 + LURE_PICKUP_PER_LEVEL * lure;

/** `moveSpeed` and `pickupRadius` as the snapshot derives them. */
export const moveSpeedOf = (bellows: number): number =>
  MOVE_SPEED * speedMul(bellows);
export const pickupRadiusOf = (lure: number): number =>
  PICKUP_RADIUS * pickupMul(lure);

/** A weapon's current cooldown from its table cooldown and the Oil level held. */
export function cooldownOf(tableCooldown: number, oil: number): number {
  return Math.max(MIN_COOLDOWN, tableCooldown * cooldownMul(oil));
}

/* ---- Progression (specs/progression.md) --------------------------------- */

export const WEAPON_SLOTS = 6;
export const PASSIVE_SLOTS = 6;
export const MAX_WEAPON_LEVEL = 8;
export const XP_BASE = 5;
export const XP_STEP = 10;

/** `xpToNext(level) = XP_BASE + XP_STEP × (level − 1)`. */
export function xpToNext(level: number): number {
  return XP_BASE + XP_STEP * (level - 1);
}

export const OFFER_COUNT = 3;
export const LAMP_OIL_ID = "lamp-oil";
export const LAMP_OIL_NAME = "Lamp Oil";

/** Lamp oil's line, character for character (`specs/ui.md`, Descriptions). */
export const LAMP_OIL_DESCRIPTION = "Restores 30 health and fills no slot.";

export const LAMP_OIL_HEAL = 30;

/* ---- Weapons (specs/weapons.md) ----------------------------------------- */

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

/** Everything a level-up overlay can present. */
export type OfferId = WeaponId | PassiveId | typeof LAMP_OIL_ID;

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

/** Each weapon's line, character for character (`specs/ui.md`, Descriptions). */
export const WEAPON_DESCRIPTIONS: Readonly<Record<WeaponId, string>> = {
  taper: "A slash in the way you face, striking everything the arc covers.",
  ember: "A bolt at the nearest enemy, spent on the first thing it hits.",
  pin: "A fan of darts at the nearest enemy, each one piercing.",
  lantern: "Lanterns that circle the lamp and burn what they pass through.",
  halo: "A ring of light around the lamp that pulses on its own rhythm.",
  "oil-splash":
    "Puddles scattered nearby that burn everything standing in them.",
  spark: "Strikes on random enemies within range of the lamp.",
  shard: "A shard that bounces off the edges of the view and keeps going.",
  sconce: "A boomerang that slows, turns, and comes back to the lamp.",
  flare: "A burst that catches every enemy around the lamp at once.",
  pyre: "Taper transformed: a wider slash that feeds the lamp as it lands.",
  beacon: "Ember transformed: a faster bolt that carries through a crowd.",
  hail: "Pin transformed: a wider fan of darts that pierce further.",
  chandelier: "Lantern transformed: lanterns that never go out.",
  corona: "Halo transformed: a wider ring that feeds the lamp as it pulses.",
  blaze: "Oil Splash transformed: puddles that burn hotter and faster.",
};

/** A projectile hits never lower or remove. */
export const INFINITE_PIERCE = -1;

/** A weapon's table rows and its fixed evolved row share these shapes. */
export interface SlashRow {
  damage: number;
  cooldown: number;
  width: number;
  height: number;
  amount: number;
}
export interface BoltRow {
  damage: number;
  cooldown: number;
  speed: number;
  radius: number;
  pierce: number;
  duration: number;
  amount: number;
}
export interface OrbitRow {
  damage: number;
  cooldown: number;
  orbit: number;
  radius: number;
  duration: number;
  amount: number;
}
export interface RadialRow {
  damage: number;
  cooldown: number;
  radius: number;
}
export interface PuddleRow {
  damage: number;
  cooldown: number;
  radius: number;
  duration: number;
  amount: number;
}
export interface StrikeRow {
  damage: number;
  cooldown: number;
  area: number;
  amount: number;
}
export interface PersistentBoltRow {
  damage: number;
  cooldown: number;
  speed: number;
  radius: number;
  duration: number;
  amount: number;
}

/** Taper: row `i` is level `i + 1`. */
export const TAPER_LEVELS: readonly SlashRow[] = [
  { damage: 10, cooldown: 1.35, width: 120, height: 40, amount: 1 },
  { damage: 15, cooldown: 1.35, width: 120, height: 40, amount: 1 },
  { damage: 15, cooldown: 1.35, width: 120, height: 40, amount: 2 },
  { damage: 15, cooldown: 1.35, width: 140, height: 48, amount: 2 },
  { damage: 20, cooldown: 1.35, width: 140, height: 48, amount: 2 },
  { damage: 20, cooldown: 1.2, width: 140, height: 48, amount: 2 },
  { damage: 25, cooldown: 1.2, width: 140, height: 48, amount: 2 },
  { damage: 30, cooldown: 1.2, width: 160, height: 56, amount: 2 },
];
export const TAPER_MAX_AMOUNT = 2;
export const SLASH_FLASH = 0.1;

export const EMBER_LEVELS: readonly BoltRow[] = [
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

export const PIN_LEVELS: readonly BoltRow[] = [
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
/** Dart `i` of `n` starts at `y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`. */
export const PIN_SPREAD = 10;

export const LANTERN_LEVELS: readonly OrbitRow[] = [
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
/** Degrees per second a lantern revolves, clockwise. */
export const LANTERN_ANGULAR_SPEED = 180;
export const LANTERN_REHIT = 0.5;

export const HALO_LEVELS: readonly RadialRow[] = [
  { damage: 3, cooldown: 1, radius: 80 },
  { damage: 3, cooldown: 1, radius: 90 },
  { damage: 4, cooldown: 1, radius: 90 },
  { damage: 4, cooldown: 0.8, radius: 100 },
  { damage: 5, cooldown: 0.8, radius: 100 },
  { damage: 5, cooldown: 0.8, radius: 110 },
  { damage: 6, cooldown: 0.7, radius: 110 },
  { damage: 8, cooldown: 0.6, radius: 120 },
];

export const OIL_SPLASH_LEVELS: readonly PuddleRow[] = [
  { damage: 4, cooldown: 3, radius: 50, duration: 2.5, amount: 1 },
  { damage: 4, cooldown: 3, radius: 50, duration: 2.5, amount: 2 },
  { damage: 5, cooldown: 3, radius: 55, duration: 2.5, amount: 2 },
  { damage: 5, cooldown: 2.5, radius: 55, duration: 3, amount: 2 },
  { damage: 6, cooldown: 2.5, radius: 60, duration: 3, amount: 3 },
  { damage: 6, cooldown: 2.5, radius: 60, duration: 3.5, amount: 3 },
  { damage: 7, cooldown: 2, radius: 65, duration: 3.5, amount: 3 },
  { damage: 8, cooldown: 2, radius: 70, duration: 4, amount: 4 },
];
/** A puddle lands within this radius of the player's center. */
export const OIL_SCATTER = 400;
export const OIL_PULSE = 0.3;

export const SPARK_LEVELS: readonly StrikeRow[] = [
  { damage: 15, cooldown: 2, area: 40, amount: 1 },
  { damage: 15, cooldown: 2, area: 40, amount: 2 },
  { damage: 20, cooldown: 2, area: 40, amount: 2 },
  { damage: 20, cooldown: 1.8, area: 50, amount: 2 },
  { damage: 25, cooldown: 1.8, area: 50, amount: 3 },
  { damage: 25, cooldown: 1.6, area: 50, amount: 3 },
  { damage: 30, cooldown: 1.6, area: 60, amount: 3 },
  { damage: 40, cooldown: 1.4, area: 70, amount: 4 },
];
export const SPARK_RANGE = 600;
export const SPARK_FLASH = 0.2;

export const SHARD_LEVELS: readonly PersistentBoltRow[] = [
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
export const SHARD_REHIT = 0.5;
export const SHARD_SPREAD = 15;

export const SCONCE_LEVELS: readonly PersistentBoltRow[] = [
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
/** A sconce decelerates at this rate along its launch direction. */
export const SCONCE_DECEL = 600;
export const SCONCE_REHIT = 0.5;
export const SCONCE_SPREAD = 20;

export const FLARE_LEVELS: readonly RadialRow[] = [
  { damage: 100, cooldown: 60, radius: 640 },
  { damage: 100, cooldown: 55, radius: 640 },
  { damage: 150, cooldown: 55, radius: 640 },
  { damage: 150, cooldown: 50, radius: 640 },
  { damage: 200, cooldown: 50, radius: 640 },
  { damage: 200, cooldown: 45, radius: 640 },
  { damage: 300, cooldown: 45, radius: 640 },
  { damage: 500, cooldown: 40, radius: 640 },
];
export const FLARE_FLASH = 0.4;

/** The tables by base weapon id. */
export const WEAPON_LEVELS = {
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
} as const;

/** The weapons that need a target to fire (specs/weapons.md, Targeting summary). */
export const NEEDS_TARGET: readonly WeaponId[] = [
  "ember",
  "spark",
  "sconce",
  "beacon",
];

/* ---- Evolutions (specs/evolutions.md) ----------------------------------- */

export interface Evolution {
  from: BaseWeaponId;
  passive: PassiveId;
}

/** The recipes, keyed by the evolved weapon's id. */
export const EVOLUTIONS: Readonly<Record<EvolutionId, Evolution>> = {
  pyre: { from: "taper", passive: "wick" },
  beacon: { from: "ember", passive: "oil" },
  hail: { from: "pin", passive: "mirror" },
  chandelier: { from: "lantern", passive: "glass" },
  corona: { from: "halo", passive: "tinder" },
  blaze: { from: "oil-splash", passive: "soot" },
};

/** The base weapon each evolution comes from, inverted: base id → evolved id. */
export const EVOLUTION_OF: Readonly<
  Partial<Record<BaseWeaponId, EvolutionId>>
> = {
  taper: "pyre",
  ember: "beacon",
  pin: "hail",
  lantern: "chandelier",
  halo: "corona",
  "oil-splash": "blaze",
};

export const PYRE_STATS: SlashRow = {
  damage: 60,
  cooldown: 1.2,
  width: 200,
  height: 60,
  amount: 2,
};
export const PYRE_HEAL = 1;

export const BEACON_STATS: BoltRow = {
  damage: 20,
  cooldown: 0.25,
  speed: 500,
  radius: 10,
  pierce: 2,
  duration: 2,
  amount: 1,
};

export const HAIL_STATS: BoltRow = {
  damage: 15,
  cooldown: 0.5,
  speed: 700,
  radius: 7,
  pierce: 3,
  duration: 1.5,
  amount: 6,
};

export interface PermanentOrbitRow {
  damage: number;
  orbit: number;
  radius: number;
  amount: number;
}
export const CHANDELIER_STATS: PermanentOrbitRow = {
  damage: 25,
  orbit: 120,
  radius: 20,
  amount: 4,
};

export const CORONA_STATS: RadialRow = {
  damage: 12,
  cooldown: 0.5,
  radius: 150,
};
export const CORONA_HEAL = 1;

export const BLAZE_STATS: PuddleRow = {
  damage: 8,
  cooldown: 2,
  radius: 70,
  duration: 4,
  amount: 5,
};
export const BLAZE_PULSE = 0.2;

/** A chest with nothing to evolve or level heals this much. */
export const CHEST_HEAL = 30;

/* ---- Enemies (specs/enemies.md) ----------------------------------------- */

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

export type EnemyRank = "common" | "elite" | "dark";
export type EnemyBehavior = "chase" | "drift" | "weave";

export interface Enemy {
  rank: EnemyRank;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  /** The gem a common drops; an elite drops a chest and the Dark nothing. */
  gem: GemTier | null;
  behavior: EnemyBehavior;
}

export const ENEMIES: Readonly<Record<EnemyId, Enemy>> = {
  moth: {
    rank: "common",
    hp: 5,
    speed: 100,
    damage: 5,
    radius: 10,
    gem: "small",
    behavior: "chase",
  },
  bat: {
    rank: "common",
    hp: 8,
    speed: 140,
    damage: 5,
    radius: 10,
    gem: "small",
    behavior: "chase",
  },
  rat: {
    rank: "common",
    hp: 15,
    speed: 120,
    damage: 8,
    radius: 12,
    gem: "small",
    behavior: "chase",
  },
  gnat: {
    rank: "common",
    hp: 2,
    speed: 160,
    damage: 3,
    radius: 8,
    gem: "small",
    behavior: "drift",
  },
  beetle: {
    rank: "common",
    hp: 25,
    speed: 60,
    damage: 10,
    radius: 14,
    gem: "medium",
    behavior: "chase",
  },
  wisp: {
    rank: "common",
    hp: 12,
    speed: 90,
    damage: 6,
    radius: 10,
    gem: "medium",
    behavior: "weave",
  },
  spider: {
    rank: "common",
    hp: 40,
    speed: 80,
    damage: 12,
    radius: 14,
    gem: "medium",
    behavior: "chase",
  },
  crow: {
    rank: "common",
    hp: 30,
    speed: 150,
    damage: 10,
    radius: 12,
    gem: "medium",
    behavior: "chase",
  },
  shade: {
    rank: "common",
    hp: 60,
    speed: 70,
    damage: 15,
    radius: 16,
    gem: "medium",
    behavior: "chase",
  },
  hound: {
    rank: "common",
    hp: 120,
    speed: 110,
    damage: 20,
    radius: 18,
    gem: "large",
    behavior: "chase",
  },
  mothwing: {
    rank: "elite",
    hp: 600,
    speed: 90,
    damage: 20,
    radius: 28,
    gem: null,
    behavior: "chase",
  },
  owl: {
    rank: "elite",
    hp: 2000,
    speed: 100,
    damage: 30,
    radius: 36,
    gem: null,
    behavior: "chase",
  },
  dark: {
    rank: "dark",
    hp: 10000,
    speed: 170,
    damage: 50,
    radius: 40,
    gem: null,
    behavior: "chase",
  },
};

/** The ten common ids, in `ENEMY_IDS` order. */
/**
 * Each type's display name, the Enemy column of the roster tables
 * (`specs/enemies.md`), which the almanac and the HUD draw.
 */
export const ENEMY_NAMES: Readonly<Record<EnemyId, string>> = {
  moth: "Moth",
  bat: "Bat",
  rat: "Rat",
  gnat: "Gnat",
  beetle: "Beetle",
  wisp: "Wisp",
  spider: "Spider",
  crow: "Crow",
  shade: "Shade",
  hound: "Hound",
  mothwing: "Mothwing",
  owl: "Owl",
  dark: "The Dark",
};

/** Each type's line, character for character (`specs/ui.md`, Descriptions). */
export const ENEMY_DESCRIPTIONS: Readonly<Record<EnemyId, string>> = {
  moth: "The first thing the light draws. Slow, weak, and never alone.",
  bat: "Quicker than a moth and just as thin.",
  rat: "Low and steady, and it takes more than one hit.",
  gnat: "Drifts in a straight line and never turns. Arrives in swarms.",
  beetle: "Armored and slow, and it hurts more than it looks like it should.",
  wisp: "Weaves as it comes, so it never quite arrives where you expect.",
  spider: "Fast and tough, and it closes the distance quickly.",
  crow: "Fast, and it hits hard for its size.",
  shade: "Heavy and slow, and it leaves a larger gem behind.",
  hound: "The heaviest of the common dark, and the fastest of the heavy.",
  mothwing: "An elite: a great moth that drops a chest when it falls.",
  owl: "An elite: silent, heavy, and it drops a chest when it falls.",
  dark: "The night itself, from nine minutes on. It outlasts almost anything.",
};

export const COMMON_ENEMY_IDS: readonly EnemyId[] = ENEMY_IDS.filter(
  (id) => ENEMIES[id].rank === "common",
);

/** The types a Flare burst leaves untouched. */
export const FLARE_IMMUNE: readonly EnemyId[] = ["dark"];

/** `hpMul(time) = 1 + HP_SCALE_PER_MINUTE × floor(time / 60)`. */
export const HP_SCALE_PER_MINUTE = 0.15;
export function hpMul(time: number): number {
  return 1 + HP_SCALE_PER_MINUTE * Math.floor(time / 60);
}

/** The weave: `offset(age) = WISP_AMPLITUDE × sin(2π × age / WISP_PERIOD)`. */
export const WISP_AMPLITUDE = 40;
export const WISP_PERIOD = 1;
export function weaveOffset(age: number): number {
  return WISP_AMPLITUDE * Math.sin((2 * Math.PI * age) / WISP_PERIOD);
}

/* ---- The spawn director (specs/enemies.md) ------------------------------ */

export const SPAWN_DISTANCE = 760;
export const DESPAWN_DISTANCE = 1200;
export const SPAWN_WINDOW = 30;

/** The window index at run clock `time`: `min(19, floor(time / SPAWN_WINDOW))`. */
export function spawnWindowOf(time: number): number {
  return Math.min(19, Math.floor(time / SPAWN_WINDOW));
}

export interface SpawnWindowRow {
  types: readonly EnemyId[];
  interval: number;
  cap: number;
}

/** One row per window, window 0 first. */
export const SPAWN_WINDOWS: readonly SpawnWindowRow[] = [
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

export type ScriptedEventKind = "swarm" | "mothwing" | "owl" | "dark";

export interface ScriptedEvent {
  /** The run-clock second the event fires on: tick `time × TICK_HZ`. */
  time: number;
  kind: ScriptedEventKind;
}

/** The night's scripted spawns, in time order. */
export const EVENTS: readonly ScriptedEvent[] = [
  { time: 60, kind: "swarm" },
  { time: 120, kind: "mothwing" },
  { time: 240, kind: "swarm" },
  { time: 300, kind: "mothwing" },
  { time: 420, kind: "swarm" },
  { time: 450, kind: "owl" },
  { time: 540, kind: "dark" },
];

/** A gnat swarm: this many gnats, evenly spaced along a line this long. */
export const SWARM_SIZE = 24;
export const SWARM_LINE = 720;

/* ---- Screens, copy, and menus (specs/ui.md) ----------------------------- */

export const TITLE_TEXT = "WICK";
export const TAGLINE_TEXT = "KEEP THE LIGHT";
/** The title menu, in this order (`specs/ui.md`, `title`). */
export const TITLE_ITEMS = [
  "LIGHT THE LAMP",
  "THE ALMANAC",
  "HOW TO PLAY",
] as const;
export const LEVEL_UP_TEXT = "THE LAMP BURNS BRIGHTER";
export const CHEST_TEXT = "A CHEST OPENS";
export const PAUSED_TEXT = "PAUSED";

/** The pause menu, in this order (`specs/ui.md`, `paused`). */
export const PAUSE_ITEMS = ["RESUME", "MAIN MENU"] as const;

export const FALLEN_TEXT = "THE LIGHT WENT OUT";
export const DAWN_TEXT = "DAWN";
export const END_ITEMS = ["TRY AGAIN", "TITLE"] as const;
export const OFFER_NEW_TEXT = "NEW";
export const LEVEL_LABEL = "LEVEL";

/* ---- The almanac (specs/ui.md, `almanac`) ------------------------------- */

/** The almanac screen's heading. */
export const ALMANAC_TEXT = "THE ALMANAC";

/** The almanac's tab bar, in this order. */
export const ALMANAC_TABS = [
  "TOOLS",
  "TRINKETS",
  "ENEMIES",
  "PICKUPS",
] as const;
export type AlmanacTab = (typeof ALMANAC_TABS)[number];

/** Entry rows the almanac's list shows at once. */
export const ALMANAC_ROWS = 10;

/** One entry of the pickups tab: a gem tier, then a pickup kind. */
export type AlmanacPickupId = GemTier | PickupKind;

/** The tools tab's entries: "the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`". */
export const ALMANAC_TOOL_IDS: readonly WeaponId[] = [
  ...BASE_WEAPON_IDS,
  ...EVOLUTION_IDS,
];

/** The trinkets tab's entries: "the ten of `PASSIVE_IDS`". */
export const ALMANAC_TRINKET_IDS: readonly PassiveId[] = PASSIVE_IDS;

/** The enemies tab's entries: "the thirteen of `ENEMY_IDS`". */
export const ALMANAC_ENEMY_IDS: readonly EnemyId[] = ENEMY_IDS;

/** The pickups tab's entries: "the three of `GEM_TIERS`, then the three of `PICKUP_KINDS`". */
export const ALMANAC_PICKUP_IDS: readonly AlmanacPickupId[] = [
  ...GEM_TIERS,
  ...PICKUP_KINDS,
];

/** The names each tab's rows show, in the tab's own order. */
export const ALMANAC_ENTRY_NAMES: Readonly<
  Record<AlmanacTab, readonly string[]>
> = {
  TOOLS: ALMANAC_TOOL_IDS.map((id) => WEAPON_NAMES[id]),
  TRINKETS: ALMANAC_TRINKET_IDS.map((id) => PASSIVES[id].name),
  ENEMIES: ALMANAC_ENEMY_IDS.map((id) => ENEMY_NAMES[id]),
  PICKUPS: [
    ...GEM_TIERS.map((tier) => GEM_NAMES[tier]),
    ...PICKUP_KINDS.map((kind) => PICKUP_NAMES[kind]),
  ],
};

/** The line the detail pane draws for each entry, in the tab's own order. */
export const ALMANAC_ENTRY_DESCRIPTIONS: Readonly<
  Record<AlmanacTab, readonly string[]>
> = {
  TOOLS: ALMANAC_TOOL_IDS.map((id) => WEAPON_DESCRIPTIONS[id]),
  TRINKETS: ALMANAC_TRINKET_IDS.map((id) => PASSIVE_DESCRIPTIONS[id]),
  ENEMIES: ALMANAC_ENEMY_IDS.map((id) => ENEMY_DESCRIPTIONS[id]),
  PICKUPS: [
    ...GEM_TIERS.map((tier) => GEM_DESCRIPTIONS[tier]),
    ...PICKUP_KINDS.map((kind) => PICKUP_DESCRIPTIONS[kind]),
  ],
};

/** Entries each tab holds: the `count` the scroll rule is held against. */
export const ALMANAC_ENTRY_COUNTS: Readonly<Record<AlmanacTab, number>> = {
  TOOLS: ALMANAC_TOOL_IDS.length,
  TRINKETS: ALMANAC_TRINKET_IDS.length,
  ENEMIES: ALMANAC_ENEMY_IDS.length,
  PICKUPS: ALMANAC_PICKUP_IDS.length,
};

/**
 * The stat labels the detail pane writes, "the label written exactly as it
 * appears there": `DAMAGE` and `COOLDOWN` on a tool, `MAX LEVEL` on a trinket,
 * `HEALTH`, `SPEED` and `DAMAGE` on an enemy, `EXPERIENCE` on a gem, and
 * `HEALS` on bread.
 */
export const ALMANAC_STAT_LABELS = {
  damage: "DAMAGE",
  cooldown: "COOLDOWN",
  maxLevel: "MAX LEVEL",
  health: "HEALTH",
  speed: "SPEED",
  experience: "EXPERIENCE",
  heals: "HEALS",
} as const;

/**
 * The furthest `almanacScroll` reaches on `tab`:
 * `max(0, count − ALMANAC_ROWS)`.
 */
export function almanacScrollMax(tab: AlmanacTab): number {
  return Math.max(0, ALMANAC_ENTRY_COUNTS[tab] - ALMANAC_ROWS);
}

/** The run clock as the HUD and the end screens draw it: `m:ss`. */
export function clockText(tick: number): string {
  const seconds = Math.floor(tick / TICK_HZ);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/* ---- Controls (specs/controls.md) --------------------------------------- */

/** The touch layout `src/main.ts` hands the engine. */
export const LAYOUT = "dpad-4";

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

/** Each action's `KeyboardEvent.code` bindings. */
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

/**
 * Logical units of wheel travel that scroll the almanac's list by one row:
 * `specs/controls.md`, The pointer, "divided by `WHEEL_ROW` (`100`) and
 * truncated toward zero to give the number of rows `almanacScroll` moves".
 * Travel is read in stage units, the coordinates the pointer is read in.
 */
export const WHEEL_ROW = 100;

/** The key the engine toggles its diagnostics overlay with (specs/instrumentation.md). */
export const OVERLAY_TOGGLE_CODE = "Backquote";

/* ---- Audio (specs/ui.md, specs/assets.md) ------------------------------- */

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

/** Every cue, in the order `specs/ui.md` tabulates them. */
export const CUE_NAMES: readonly CueName[] = Object.values(CUES);

/** The two cues that loop until stopped. */
export const LOOPING_CUES: readonly CueName[] = [CUES.music, CUES.hum];

/** The thirteen one-shot cues. */
export const ONE_SHOT_CUES: readonly CueName[] = CUE_NAMES.filter(
  (cue) => !LOOPING_CUES.includes(cue),
);

/** Each cue's produced file, relative to the `assets/` root the loader resolves under. */
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

/** The least the bed and the hum run, in seconds. */
export const MUSIC_MIN_SECONDS = 30;
export const HUM_MIN_SECONDS = 2;

/** `|last sample − first sample|` in every channel of a looping file, as a share of full scale. */
export const LOOP_SEAM_TOLERANCE = 0.01;

/* ---- Sprites (specs/assets.md) ------------------------------------------ */

/** The root every produced path resolves under, relative to the repository. */
export const ASSET_ROOT = "assets";

/** A produced path under the asset root as a repository-relative file. */
export function assetFile(path: string): string {
  return `${ASSET_ROOT}/${path}`;
}

/** Frame `frame` of a sheet whose frames are separate files under `dir`. */
export function sheetFrame(dir: string, frame: number): string {
  return `${dir}/${frame}.png`;
}

export interface SpriteSheet {
  dir: string;
  frames: number;
}

export const LAMPLIGHTER_SPRITE_WIDTH = 24;
export const LAMPLIGHTER_SPRITE_HEIGHT = 32;
export const LAMPLIGHTER_IDLE_PATH = "sprites/lamplighter/idle.png";
export const LAMPLIGHTER_WALK_SHEET: SpriteSheet = {
  dir: "sprites/lamplighter/walk",
  frames: 6,
};

/** Each enemy's walk cycle sits under `<ENEMY_SHEET_DIR>/<id>/`, `ENEMY_FRAMES` frames. */
export const ENEMY_SHEET_DIR = "sprites/enemies";
export const ENEMY_FRAMES = 4;

/** Frame `frame` of enemy `id`'s sheet. */
export function enemyFrame(id: EnemyId, frame: number): string {
  return sheetFrame(`${ENEMY_SHEET_DIR}/${id}`, frame);
}

/** An enemy's square sheet canvas: twice its radius. */
export function enemySpriteSize(id: EnemyId): number {
  return ENEMIES[id].radius * 2;
}

export const PUFF_SHEET: SpriteSheet = { dir: "sprites/puff", frames: 4 };
export const PUFF_SPRITE_SIZE = 24;

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

export const PICKUP_PATHS: Readonly<Record<PickupKind, string>> = {
  chest: "sprites/pickups/chest.png",
  bread: "sprites/pickups/bread.png",
  draft: "sprites/pickups/draft.png",
};
export const PICKUP_SPRITE_SIZE = 24;

export const GROUND_TILE_PATH = "sprites/ground.png";
export const GROUND_TILE_SIZE = 64;

export interface EffectSprite {
  /** A file for one sprite, or a directory for a sheet. */
  path: string;
  frames: number;
  width: number;
  height: number;
}

/** Each weapon's effect: its file or sheet directory, frame count, and canvas. */
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

/** The file a weapon's effect draws at `frame`: its one sprite, or a frame of its sheet. */
export function effectPath(weapon: WeaponId, frame = 0): string {
  const sprite = EFFECT_SPRITES[weapon];
  return sprite.frames === 1 ? sprite.path : sheetFrame(sprite.path, frame);
}

/** The twenty-seven icons: every weapon, every passive, and lamp oil. */
export const ICON_IDS: readonly OfferId[] = [
  ...BASE_WEAPON_IDS,
  ...EVOLUTION_IDS,
  ...PASSIVE_IDS,
  LAMP_OIL_ID,
];
export const ICON_PATHS: Readonly<Record<OfferId, string>> = Object.fromEntries(
  ICON_IDS.map((id) => [id, `icons/${id}.png`]),
) as Record<OfferId, string>;
export const ICON_SIZE = 24;

/** Animation: seconds per walk or spin frame, and the death puff's whole life. */
export const WALK_FRAME_TIME = 0.1;
export const PUFF_TIME = 0.4;

/* ---- The debug surface (specs/instrumentation.md) ----------------------- */

/** `version` on the surface. */
export const WICK_DEBUG_VERSION = 1;

/** The seed `reset` uses when none is named. */
export const DEFAULT_SEED = 1;

/* ---- The suite's own figures -------------------------------------------- */

/**
 * The level an isolated world is posed at. `xpToNext(50)` is `495`, more
 * experience than any scenario's kills drop, so no gain a check's kills
 * produce crosses a threshold and opens an overlay mid-scenario. A check that
 * reads `level` poses its own.
 */
export const ISOLATE_LEVEL = 50;

/**
 * Tolerance for a figure the build reaches by one or two real-valued
 * operations: a table value times a multiplier, a sum of two reals. The
 * specification states these figures exactly and binary floating point
 * rounds each product to within a few ulps, so a bound of a billionth is
 * many orders above the rounding and far below any figure the tables
 * distinguish (the closest two are `0.1` apart).
 */
export const REAL_EPS = 1e-9;

/**
 * Tolerance for a figure the build reaches by integrating tick after tick: a
 * position after `n` steps of `speed × TICK_DT`, a timer counted down by
 * `TICK_DT` at a time, an angle advanced per tick. Each step rounds by an
 * ulp or so, and the longest span a check integrates over, the whole
 * ten-minute night at 36000 ticks, accumulates well under a millionth of a
 * unit; nothing the specification distinguishes is finer than a tenth of a
 * unit, so this bound passes every conformant integrator and fails a build
 * off by a single step.
 */
export const MOTION_EPS = 1e-6;

/** The same bound, for angles in degrees. */
export const ANGLE_EPS = 1e-6;

/**
 * How many seeded common kills the drop-roll checks make, and the bounds the
 * bread and draft counts must fall in, as the checklist states them: the
 * expected counts are `80` at `BREAD_CHANCE` and `19.6` at `DRAFT_CHANCE`
 * after a failed bread draw, and both tails of each bound are below one in a
 * hundred thousand, so a conformant build fails by chance about never while
 * a build that skipped a draw, or drew both, fails outright.
 */
export const DROP_TRIALS = 4000;
export const BREAD_COUNT_BOUNDS: readonly [number, number] = [40, 125];
export const DRAFT_COUNT_BOUNDS: readonly [number, number] = [3, 45];

/**
 * How many seeded common kills the check that a kill drops at most ONE of the
 * two pickups makes, which is a larger sample than the counting checks above
 * need.
 *
 * The rule is "Only when it did not, a second draw drops a draft"
 * (`specs/world.md`, The drop roll), and the build that breaks it most simply
 * makes the second draw unconditionally. That build's only visible mark is the
 * kill where BOTH draws land, which the two stated chances put at
 * `BREAD_CHANCE × DRAFT_CHANCE` (`0.02 × 0.005`, `1e-4`) per kill. At
 * `DROP_TRIALS` such a build leaves `0.4` shared centers expected, so it goes
 * unseen about two times in three; at `60000` it leaves `6` expected and goes
 * unseen about one time in four hundred. The figure is therefore derived from
 * the two chances the specification states and the number of shared centers
 * the check means to expect, not from any build.
 */
export const DROP_PAIR_TRIALS = 60_000;

/**
 * How many of those kills share one tick: fewer than the counting checks pose,
 * because the work a tick does over a posed field grows with the enemies and
 * the zones standing on it at once, so a long sample is cheapest in small
 * batches. Nothing about the roll depends on how the kills are divided between
 * ticks.
 */
export const DROP_PAIR_BATCH = 20;

/**
 * How close a HUD bar's measured fill ratio must be to `hp / maxHp` or
 * `xp / xpToNext`: a tenth. A bar's fill is drawn in whole device pixels, so
 * a bar a hundred units wide places a quarter within a hundredth of the
 * ratio; a tenth leaves room for any rounding, border, or inset a build
 * draws the fill with while still failing a bar that does not scale.
 */
export const HUD_BAR_RATIO_TOL = 0.1;

/**
 * How far apart, as a share of the bar's whole width, the left edges of two
 * bands read off the same near-empty frame may sit and still be one bar
 * "filled from its left edge" (`specs/ui.md`, the HUD table).
 *
 * A bar anchored at its left edge grows to the right alone, so both bands
 * begin where the near-empty frame's fill ended and only their right edges
 * differ: a conformant bar puts them on the same column, and the only thing
 * that can move one of them is a border, an inset, or a rounded end, which is
 * a pixel or two on a bar legible at the 1280 x 720 stage. A tenth of the
 * bar's width is far past any of those, and half of the fifth of the width the
 * smallest reflection of a fill moves a band's left edge by.
 *
 * A bar CENTRED on its own track moves a band's left edge by only half what a
 * reflection does — half of what that fill is short by — so this bound tells a
 * centred bar from a left-anchored one only where the band read is small. The
 * suites that use it therefore read a left edge off a band around a quarter or
 * a fifth of the bar, which a centred bar puts more than a third of the bar's
 * width from its start.
 */
export const HUD_BAR_LEFT_TOL = 0.1;

/**
 * How far one channel may drift before two decoded pixels count as
 * different, when two produced files are compared: a PNG is lossless, so a
 * file shipped twice differs by exactly nothing, and eight levels of 255 is
 * far below any visible difference between two sprites.
 */
export const PIXEL_CHANNEL_EPS = 8;

/**
 * The peak a produced sound must reach to be carrying signal rather than
 * silence: a hundredth of full scale, 40 dB down, inaudible under any mix.
 */
export const SILENCE_FLOOR = 0.01;
