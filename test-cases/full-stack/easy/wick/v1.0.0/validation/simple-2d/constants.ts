// Wick — every figure the checks assert with, stated FROM THE SPECS.
// CASE-PROVIDED.
//
// This file restates the figures the rendered specification fixes, each beside
// the file that fixes it, and imports nothing: not the build's `src/game.ts`,
// and not the seeded `src/constants.ts` either. A validator's assertions trace
// to the specification alone, so the numbers it compares against are declared
// here from the spec text. A build, or a seeded file, that drifted from the
// specification must FAIL the checks, not recalibrate them.
//
// Formulas the specs state as arithmetic (the experience curve, the derived
// stats, the health scaling, the timer rule's tick count) are declared as
// functions spelled exactly as the spec spells them. The tolerances at the end
// are the only figures here the specs do not state; each carries the reason it
// is honest.

/* ------------------------------- The tick --------------------------------- */
// specs/overview.md: "The simulation advances on a fixed tick of TICK_HZ (60)
// ticks per second, each TICK_DT (1/60) seconds long"; specs/instrumentation.md:
// "A tick is consumed while the accumulator is at least TICK_DT − TICK_EPSILON,
// with TICK_EPSILON (1e-9) seconds".

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;
export const TICK_EPSILON = 1e-9;
/** One tick of game time, in milliseconds: the ConstantClock step of a frame. */
export const TICK_MS = 1000 / TICK_HZ;

/** specs/world.md: "the run ends at dawn on the tick the clock reaches DAWN_TIME (600)". */
export const DAWN_TIME = 600;
/** specs/world.md, Fallen and dawn: "tick equals DAWN_TIME × TICK_HZ (36000)". */
export const DAWN_TICK = DAWN_TIME * TICK_HZ;

/**
 * specs/world.md, Timers: "a timer set to s seconds is due round(s × TICK_HZ)
 * ticks after the tick it was set on", and "An interval of s seconds anywhere
 * in this specification is likewise round(s × TICK_HZ) ticks". The rounding is
 * the whole of the slack a duration stated in seconds carries.
 */
export function ticksFor(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/* ------------------------------- The stage -------------------------------- */
// specs/overview.md: "a fixed logical stage of STAGE_W x STAGE_H (1280 x 720)
// ... with its center at (STAGE_CX, STAGE_CY) (640, 360)".

export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STAGE_CX = 640;
export const STAGE_CY = 360;

/* ---------------------------- The lamplighter ----------------------------- */
// specs/world.md, The lamplighter table, Contact damage table, and Gems.

export const MOVE_SPEED = 180;
export const PLAYER_RADIUS = 12;
export const BASE_MAX_HP = 100;
export const BASE_RECOVERY = 0;
export const PICKUP_RADIUS = 48;
export const CONTACT_COOLDOWN = 0.5;
export const MIN_DAMAGE_TAKEN = 1;
/**
 * specs/world.md, Contact damage: "Seconds the hurt flash runs | `HURT_FLASH` |
 * `0.3`". The lamplighter's `hurtFlash` "is set to HURT_FLASH on every tick on
 * which a contact hit lands, whatever the number of hits that tick".
 */
export const HURT_FLASH = 0.3;
export const GEM_SPEED = 600;
export const COLLECT_RADIUS = 8;

/* ------------------------------- Passives --------------------------------- */
// specs/passives.md, The ten passives and The derived stats.

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

export const PASSIVES: Readonly<
  Record<PassiveId, { name: string; maxLevel: number }>
> = {
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

/** specs/passives.md, Cooldown: "floored at MIN_COOLDOWN (0.2) seconds". */
export const MIN_COOLDOWN = 0.2;

/** The levels held, by passive id; a passive not held is level 0. */
export type HeldPassives = Partial<Record<PassiveId, number>>;

/** The derived stats, each spelled as specs/passives.md spells it. */
export const derived = {
  damageMul: (p: HeldPassives): number =>
    1 + WICK_DAMAGE_PER_LEVEL * (p.wick ?? 0),
  cooldownMul: (p: HeldPassives): number =>
    1 - OIL_COOLDOWN_PER_LEVEL * (p.oil ?? 0),
  areaMul: (p: HeldPassives): number =>
    1 + GLASS_AREA_PER_LEVEL * (p.glass ?? 0),
  armor: (p: HeldPassives): number => BRASS_ARMOR_PER_LEVEL * (p.brass ?? 0),
  amountBonus: (p: HeldPassives): number =>
    MIRROR_AMOUNT_PER_LEVEL * (p.mirror ?? 0),
  speedMul: (p: HeldPassives): number =>
    1 + BELLOWS_SPEED_PER_LEVEL * (p.bellows ?? 0),
  maxHp: (p: HeldPassives): number =>
    BASE_MAX_HP + TALLOW_HP_PER_LEVEL * (p.tallow ?? 0),
  recovery: (p: HeldPassives): number =>
    BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL * (p.tinder ?? 0),
  xpMul: (p: HeldPassives): number => 1 + SOOT_XP_PER_LEVEL * (p.soot ?? 0),
  pickupMul: (p: HeldPassives): number =>
    1 + LURE_PICKUP_PER_LEVEL * (p.lure ?? 0),
} as const;

/** The move speed the snapshot reports: MOVE_SPEED × speedMul. */
export function moveSpeedFor(p: HeldPassives): number {
  return MOVE_SPEED * derived.speedMul(p);
}

/** The pickup radius the snapshot reports: PICKUP_RADIUS × pickupMul. */
export function pickupRadiusFor(p: HeldPassives): number {
  return PICKUP_RADIUS * derived.pickupMul(p);
}

/**
 * A weapon's current cooldown: "max(MIN_COOLDOWN, table cooldown × cooldownMul)"
 * (specs/passives.md, Cooldown).
 */
export function cooldownFor(tableCooldown: number, p: HeldPassives): number {
  return Math.max(MIN_COOLDOWN, tableCooldown * derived.cooldownMul(p));
}

/* ------------------------------ Progression ------------------------------- */
// specs/progression.md, Slots and Levels and experience, The draw.

export const WEAPON_SLOTS = 6;
export const PASSIVE_SLOTS = 6;
export const MAX_WEAPON_LEVEL = 8;
export const XP_BASE = 5;
export const XP_STEP = 10;
export const OFFER_COUNT = 3;
export const LAMP_OIL_ID = "lamp-oil";
export const LAMP_OIL_NAME = "Lamp Oil";
export const LAMP_OIL_HEAL = 30;

/** "xpToNext(level) = XP_BASE + XP_STEP × (level - 1)". */
export function xpToNext(level: number): number {
  return XP_BASE + XP_STEP * (level - 1);
}

/* ------------------------------- Weapons ---------------------------------- */
// specs/weapons.md, Targeting summary and the level tables; specs/evolutions.md.

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

/** Everything a level-up overlay can offer (specs/state.md, The type aliases). */
export type OfferId = WeaponId | PassiveId | typeof LAMP_OIL_ID;

/** specs/weapons.md, Projectiles and pierce: "INFINITE_PIERCE (-1)". */
export const INFINITE_PIERCE = -1;

/** The weapons `spawnProjectile` poses (specs/instrumentation.md). */
export const PROJECTILE_WEAPONS = [
  "ember",
  "pin",
  "shard",
  "sconce",
  "beacon",
  "hail",
] as const;
export type ProjectileWeapon = (typeof PROJECTILE_WEAPONS)[number];

/** The weapons `spawnPuddle` poses (specs/instrumentation.md). */
export const PUDDLE_WEAPONS = ["oil-splash", "blaze"] as const;
export type PuddleWeapon = (typeof PUDDLE_WEAPONS)[number];

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

/** specs/weapons.md, Taper. Row i is level i + 1. */
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
/** "Any amount above TAPER_MAX_AMOUNT (2) adds nothing." */
export const TAPER_MAX_AMOUNT = 2;
/** "The slash is drawn for SLASH_FLASH (0.1) seconds." */
export const SLASH_FLASH = 0.1;

/** specs/weapons.md, Ember. */
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

/** specs/weapons.md, Pin. */
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
/** "y = player.y + (i − (n − 1) / 2) × PIN_SPREAD, with PIN_SPREAD (10)". */
export const PIN_SPREAD = 10;

/** specs/weapons.md, Lantern. */
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
/** "revolve at LANTERN_ANGULAR_SPEED (180) degrees per second clockwise". */
export const LANTERN_ANGULAR_SPEED = 180;
/** "a touching effect with re-hit interval LANTERN_REHIT (0.5)". */
export const LANTERN_REHIT = 0.5;

/** specs/weapons.md, Halo. */
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

/** specs/weapons.md, Oil Splash. */
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
/** "the disk of radius OIL_SCATTER (400) about the player's center". */
export const OIL_SCATTER = 400;
/** "a pulsing effect with interval OIL_PULSE (0.3)". */
export const OIL_PULSE = 0.3;

/** specs/weapons.md, Spark. */
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
/** "the live enemies within SPARK_RANGE (600) of the player's center". */
export const SPARK_RANGE = 600;
/** "The strike is drawn for SPARK_FLASH (0.2) seconds". */
export const SPARK_FLASH = 0.2;

/** specs/weapons.md, Shard. */
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
/** "its re-hit interval is SHARD_REHIT (0.5) per shard per enemy". */
export const SHARD_REHIT = 0.5;
/** "rotated by (i − (n − 1) / 2) × SHARD_SPREAD degrees, with SHARD_SPREAD (15)". */
export const SHARD_SPREAD = 15;

/** specs/weapons.md, Sconce. */
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
/** "a constant acceleration of −SCONCE_DECEL (600) units per second squared". */
export const SCONCE_DECEL = 600;
/** "its re-hit interval is SCONCE_REHIT (0.5) per sconce per enemy". */
export const SCONCE_REHIT = 0.5;
/** "rotated by (i − (n − 1) / 2) × SCONCE_SPREAD degrees, with SCONCE_SPREAD (20)". */
export const SCONCE_SPREAD = 20;

/** specs/weapons.md, Flare. */
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
/** "The burst is drawn for FLARE_FLASH (0.4) seconds". */
export const FLARE_FLASH = 0.4;

/** Every base weapon's table, by id, "collected by id in WEAPON_LEVELS". */
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

/* ------------------------------ Evolutions -------------------------------- */
// specs/evolutions.md, The recipe and each evolved weapon's fixed row.

export const EVOLUTIONS: Readonly<
  Record<EvolutionId, { from: BaseWeaponId; passive: PassiveId }>
> = {
  pyre: { from: "taper", passive: "wick" },
  beacon: { from: "ember", passive: "oil" },
  hail: { from: "pin", passive: "mirror" },
  chandelier: { from: "lantern", passive: "glass" },
  corona: { from: "halo", passive: "tinder" },
  blaze: { from: "oil-splash", passive: "soot" },
};

export const PYRE_STATS: SlashRow = {
  damage: 60,
  cooldown: 1.2,
  width: 200,
  height: 60,
  amount: 2,
};
/** "heals the player PYRE_HEAL (1) health on the tick of the hit". */
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
export const CHANDELIER_STATS = {
  damage: 25,
  orbit: 120,
  radius: 20,
  amount: 4,
} as const;
export const CORONA_STATS: RadialRow = {
  damage: 12,
  cooldown: 0.5,
  radius: 150,
};
/** "heals the player CORONA_HEAL (1) health on that tick". */
export const CORONA_HEAL = 1;
export const BLAZE_STATS: PuddleRow = {
  damage: 8,
  cooldown: 2,
  radius: 70,
  duration: 4,
  amount: 5,
};
/** "a pulsing effect with interval BLAZE_PULSE (0.2)". */
export const BLAZE_PULSE = 0.2;

/** specs/evolutions.md, Opening a chest: "hp rises by CHEST_HEAL (30)". */
export const CHEST_HEAL = 30;

/* ------------------------- Gems and pickups ------------------------------- */
// specs/world.md, Gems and Pickups.

export const GEM_TIERS = ["small", "medium", "large"] as const;
export type GemTier = (typeof GEM_TIERS)[number];
export const GEM_VALUES: Readonly<Record<GemTier, number>> = {
  small: 1,
  medium: 3,
  large: 10,
};

export const PICKUP_KINDS = ["chest", "bread", "draft"] as const;
export type PickupKind = (typeof PICKUP_KINDS)[number];
/** "less than PICKUP_ITEM_RADIUS (16) plus PLAYER_RADIUS". */
export const PICKUP_ITEM_RADIUS = 16;
export const BREAD_HEAL = 30;
export const BREAD_CHANCE = 0.02;
export const DRAFT_CHANCE = 0.005;

/* ------------------------------- Enemies ---------------------------------- */
// specs/enemies.md, The roster and the spawn director.

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

export interface EnemyRow {
  name: string;
  rank: EnemyRank;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  drop: GemTier | "chest" | null;
  behavior: EnemyBehavior;
}

export const ENEMIES: Readonly<Record<EnemyId, EnemyRow>> = {
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

/** The ten commons, in ENEMY_IDS order. */
export const COMMON_ENEMY_IDS: readonly EnemyId[] = ENEMY_IDS.filter(
  (id) => ENEMIES[id].rank === "common",
);

/** "FLARE_IMMUNE ... holds dark alone". */
export const FLARE_IMMUNE: readonly EnemyId[] = ["dark"];

/** "hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)". */
export const HP_SCALE_PER_MINUTE = 0.15;
export function hpMul(time: number): number {
  return 1 + HP_SCALE_PER_MINUTE * Math.floor(time / 60);
}

/** specs/enemies.md, Weave. */
export const WISP_AMPLITUDE = 40;
export const WISP_PERIOD = 1;
export function weaveOffset(age: number): number {
  return WISP_AMPLITUDE * Math.sin((2 * Math.PI * age) / WISP_PERIOD);
}

/** specs/enemies.md, The spawn director. */
export const SPAWN_DISTANCE = 760;
export const DESPAWN_DISTANCE = 1200;
export const SPAWN_WINDOW = 30;
export const LAST_WINDOW = 19;

/** "min(19, floor(time / SPAWN_WINDOW))". */
export function spawnWindowAt(time: number): number {
  return Math.min(LAST_WINDOW, Math.floor(time / SPAWN_WINDOW));
}

export interface SpawnWindowRow {
  types: readonly EnemyId[];
  interval: number;
  cap: number;
}

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

export const SWARM_SIZE = 24;
export const SWARM_LINE = 720;

export interface ScriptedEvent {
  time: number;
  kind: "swarm" | "spawn";
  type: EnemyId;
}

/** specs/enemies.md, Scripted events, in time order. */
export const EVENTS: readonly ScriptedEvent[] = [
  { time: 60, kind: "swarm", type: "gnat" },
  { time: 120, kind: "spawn", type: "mothwing" },
  { time: 240, kind: "swarm", type: "gnat" },
  { time: 300, kind: "spawn", type: "mothwing" },
  { time: 420, kind: "swarm", type: "gnat" },
  { time: 450, kind: "spawn", type: "owl" },
  { time: 540, kind: "spawn", type: "dark" },
];

/* ------------------------------- Screens ---------------------------------- */
// specs/ui.md, the screen copy.

export const SCREENS = [
  "title",
  "howto",
  "almanac",
  "playing",
  "levelup",
  "chest",
  "paused",
  "fallen",
  "dawn",
] as const;
export type Screen = (typeof SCREENS)[number];

export const TITLE_TEXT = "WICK";
export const TAGLINE_TEXT = "KEEP THE LIGHT";
export const TITLE_ITEMS = [
  "LIGHT THE LAMP",
  "THE ALMANAC",
  "HOW TO PLAY",
] as const;
export const LEVEL_UP_TEXT = "THE LAMP BURNS BRIGHTER";
export const CHEST_TEXT = "A CHEST OPENS";
export const PAUSED_TEXT = "PAUSED";
/**
 * specs/ui.md (`paused`): "the menu `PAUSE_ITEMS` below it: `RESUME`,
 * `MAIN MENU`, in that order".
 */
export const PAUSE_ITEMS = ["RESUME", "MAIN MENU"] as const;
export const FALLEN_TEXT = "THE LIGHT WENT OUT";
export const DAWN_TEXT = "DAWN";
export const END_ITEMS = ["TRY AGAIN", "TITLE"] as const;
export const OFFER_NEW_TEXT = "NEW";
export const LEVEL_LABEL = "LEVEL";

/** The clock as specs/ui.md draws it: "m:ss ... the seconds always two digits". */
export function clockText(tick: number): string {
  const seconds = Math.floor(tick / TICK_HZ);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

/* ------------------------------ The almanac ------------------------------- */
// specs/ui.md (`almanac`): the ninth screen's heading, its tab bar, the window
// its list shows, and the entries each tab holds; specs/controls.md, The
// pointer, for the wheel travel one row costs.

/** "It shows `ALMANAC_TEXT` (`THE ALMANAC`)". */
export const ALMANAC_TEXT = "THE ALMANAC";

/**
 * "the tab bar `ALMANAC_TABS` (`TOOLS`, `TRINKETS`, `ENEMIES`, `PICKUPS`, in
 * that order) across the top".
 */
export const ALMANAC_TABS = [
  "TOOLS",
  "TRINKETS",
  "ENEMIES",
  "PICKUPS",
] as const;
export type AlmanacTab = (typeof ALMANAC_TABS)[number];

/** "The list shows `ALMANAC_ROWS` (`10`) entries at a time". */
export const ALMANAC_ROWS = 10;

/**
 * specs/controls.md, The pointer: a frame's wheel travel is "divided by
 * `WHEEL_ROW` (`100`) and truncated toward zero to give the number of rows
 * `almanacScroll` moves", the travel read in the stage's own units.
 */
export const WHEEL_ROW = 100;

/**
 * The gems' and the pickups' display names, from specs/ui.md's `GEM_NAMES` and
 * `PICKUP_NAMES` table.
 */
export const GEM_NAMES: Readonly<Record<GemTier, string>> = {
  small: "Small Gem",
  medium: "Medium Gem",
  large: "Large Gem",
};

export const PICKUP_NAMES: Readonly<Record<PickupKind, string>> = {
  chest: "Chest",
  bread: "Bread",
  draft: "Draft",
};

/**
 * The ids each tab lists, in the order specs/ui.md's entries table gives them:
 * `TOOLS` "the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`",
 * `TRINKETS` "the ten of `PASSIVE_IDS`", `ENEMIES` "the thirteen of
 * `ENEMY_IDS`", and `PICKUPS` "the three of `GEM_TIERS`, then the three of
 * `PICKUP_KINDS`".
 */
export const ALMANAC_ENTRIES: Readonly<Record<AlmanacTab, readonly string[]>> =
  {
    TOOLS: [...BASE_WEAPON_IDS, ...EVOLUTION_IDS],
    TRINKETS: [...PASSIVE_IDS],
    ENEMIES: [...ENEMY_IDS],
    PICKUPS: [...GEM_TIERS, ...PICKUP_KINDS],
  };

/**
 * The name each row shows, tab by tab and in the same order: "The weapon's from
 * `WEAPON_NAMES`, the passive's from `PASSIVES`, the enemy's from `ENEMIES`, or
 * the gem's or the pickup's from the names below".
 */
export const ALMANAC_ENTRY_NAMES: Readonly<
  Record<AlmanacTab, readonly string[]>
> = {
  TOOLS: [...BASE_WEAPON_IDS, ...EVOLUTION_IDS].map((id) => WEAPON_NAMES[id]),
  TRINKETS: PASSIVE_IDS.map((id) => PASSIVES[id].name),
  ENEMIES: ENEMY_IDS.map((id) => ENEMIES[id].name),
  PICKUPS: [
    ...GEM_TIERS.map((tier) => GEM_NAMES[tier]),
    ...PICKUP_KINDS.map((kind) => PICKUP_NAMES[kind]),
  ],
};

/**
 * The stat labels the detail side writes, "the label written exactly as it
 * appears there", from specs/ui.md's picture-and-stats table.
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

/* ------------------------------ Descriptions ------------------------------ */
// specs/ui.md, Descriptions: "Every tool, trinket, enemy, gem, and pickup
// carries one fixed line of copy, and the lines below are those strings
// exactly." Each is the line the almanac draws for that entry, and a weapon's,
// a passive's, and lamp oil's is also the line the level-up overlay draws
// beneath its offer list.

/** The sixteen tool lines, `taper` through `blaze`. */
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

/** The ten trinket lines, `wick` through `lure`. */
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

/** The thirteen enemy lines, `moth` through `dark`. */
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

/** The three gem lines, one per tier. */
export const GEM_DESCRIPTIONS: Readonly<Record<GemTier, string>> = {
  small: "The experience a common death leaves behind.",
  medium: "A heavier gem, worth more toward the next level.",
  large: "The heaviest gem, left by the heaviest of the dark.",
};

/** The three pickup lines, one per kind. */
export const PICKUP_DESCRIPTIONS: Readonly<Record<PickupKind, string>> = {
  chest: "Opens beside the lamp and transforms a tool at its top level.",
  bread: "Restores 30 health to the lamplighter who walks over it.",
  draft: "Draws every gem in the night to the lamp at once.",
};

/** Lamp oil's line, drawn by the level-up overlay alone. */
export const LAMP_OIL_DESCRIPTION = "Restores 30 health and fills no slot.";

/**
 * The line each row's entry carries, tab by tab and in the same order as
 * {@link ALMANAC_ENTRIES}.
 */
export const ALMANAC_ENTRY_DESCRIPTIONS: Readonly<
  Record<AlmanacTab, readonly string[]>
> = {
  TOOLS: [...BASE_WEAPON_IDS, ...EVOLUTION_IDS].map(
    (id) => WEAPON_DESCRIPTIONS[id],
  ),
  TRINKETS: PASSIVE_IDS.map((id) => PASSIVE_DESCRIPTIONS[id]),
  ENEMIES: ENEMY_IDS.map((id) => ENEMY_DESCRIPTIONS[id]),
  PICKUPS: [
    ...GEM_TIERS.map((tier) => GEM_DESCRIPTIONS[tier]),
    ...PICKUP_KINDS.map((kind) => PICKUP_DESCRIPTIONS[kind]),
  ],
};

/* ---------------------------- The idle run -------------------------------- */
// specs/state.md, "The idle run": the values `run` holds whenever `screen` is
// `title`, `howto`, or `almanac`, which `initialize` and `reset` build and
// which leaving a run for the title restores; and specs/ui.md, "A fresh run",
// which is that run with Taper at level 1 and cooldown 0 in the first weapon
// slot.

/** The stored fields of the idle run, exactly as specs/state.md's table gives them. */
export const IDLE_RUN = {
  tick: 0,
  level: 1,
  xp: 0,
  kills: 0,
  player: { x: 0, y: 0, facing: "right", hp: BASE_MAX_HP },
  hurtFlash: 0,
  weapons: [],
  passives: [],
  enemies: [],
  projectiles: [],
  zones: [],
  gems: [],
  pickups: [],
  offers: [],
  nextOffers: null,
  pendingLevelUps: 0,
  chestResult: null,
  spawnTimer: 0,
  firedEvents: [],
  nextId: 0,
  nextSpawnAngle: null,
  nextSwarmAngle: null,
  nextPuddleOffset: null,
  nextStrikeTarget: null,
  nextChestItem: null,
  nextDrop: null,
} as const;

/** The stored fields of a fresh run: the idle run, plus Taper (specs/ui.md). */
export const FRESH_RUN = {
  ...IDLE_RUN,
  weapons: [{ id: "taper", level: 1, cooldown: 0 }],
} as const;

/* ------------------------------- Controls --------------------------------- */
// specs/controls.md: the actions and the `KeyboardEvent.code` keys bound to each.

/**
 * specs/controls.md, Where input comes from: "`src/main.ts` builds the engine
 * with `LAYOUT` (`dpad-4`), so the four movement actions are the layout's own
 * vocabulary and the menu actions come with it".
 */
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

/** specs/instrumentation.md, Diagnostics: the overlay's toggle. */
export const OVERLAY_TOGGLE_CODE = "Backquote";

/* -------------------------------- Audio ----------------------------------- */
// specs/ui.md, Audio: the fifteen cues by name; specs/assets.md, The sound.

export const CUE_NAMES = [
  "hit",
  "kill",
  "gem",
  "hurt",
  "level-up",
  "choose",
  "chest",
  "evolve",
  "pickup",
  "fallen",
  "dawn",
  "menu-move",
  "menu-confirm",
  "music",
  "hum",
] as const;
export type CueName = (typeof CUE_NAMES)[number];

/** "LOOPING_CUES holds the two cues that loop until stopped". */
export const LOOPING_CUES: readonly CueName[] = ["music", "hum"];
/** The thirteen one-shot cues. */
export const ONE_SHOT_CUES: readonly CueName[] = CUE_NAMES.filter(
  (cue) => !LOOPING_CUES.includes(cue),
);

/** Each cue's produced file, relative to the `assets/` root the loader resolves under. */
export const CUE_PATHS: Readonly<Record<CueName, string>> = Object.fromEntries(
  CUE_NAMES.map((cue) => [cue, `audio/${cue}.wav`]),
) as Record<CueName, string>;
export const MUSIC_SCORE_PATH = "audio/music.mid";
export const MUSIC_MIN_SECONDS = 30;
export const HUM_MIN_SECONDS = 2;
/** "differ by at most LOOP_SEAM_TOLERANCE (0.01) of full scale". */
export const LOOP_SEAM_TOLERANCE = 0.01;

/* ------------------------------- Sprites ---------------------------------- */
// specs/assets.md, The sprites, The weapon effects, The icons, Animation. Every
// path is relative to the `assets/` root.

export const WALK_FRAME_TIME = 0.1;
export const PUFF_TIME = 0.4;

export const LAMPLIGHTER_SPRITE_WIDTH = 24;
export const LAMPLIGHTER_SPRITE_HEIGHT = 32;
export const LAMPLIGHTER_IDLE_PATH = "sprites/lamplighter/idle.png";
export const LAMPLIGHTER_WALK_DIR = "sprites/lamplighter/walk";
export const LAMPLIGHTER_WALK_FRAMES = 6;

export const ENEMY_SHEET_DIR = "sprites/enemies";
export const ENEMY_FRAMES = 4;
/** An enemy's sheet canvas: "twice its radius in ENEMIES, square". */
export function enemySpriteSize(id: EnemyId): number {
  return 2 * ENEMIES[id].radius;
}
/** Frame `frame` of enemy `id`'s sheet. */
export function enemyFramePath(id: EnemyId, frame: number): string {
  return `${ENEMY_SHEET_DIR}/${id}/${frame}.png`;
}

export const PUFF_DIR = "sprites/puff";
export const PUFF_FRAMES = 4;
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
  /** A file for one sprite, a directory for a sheet. */
  path: string;
  frames: number;
  width: number;
  height: number;
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

/** Frame `frame` of `weapon`'s effect: the file itself for a single sprite. */
export function effectFramePath(weapon: WeaponId, frame = 0): string {
  const sprite = EFFECT_SPRITES[weapon];
  return sprite.frames === 1 ? sprite.path : `${sprite.path}/${frame}.png`;
}

/** The twenty-seven icon ids, in BASE_WEAPON_IDS, EVOLUTION_IDS, PASSIVE_IDS order then lamp oil. */
export const ICON_IDS: readonly OfferId[] = [
  ...BASE_WEAPON_IDS,
  ...EVOLUTION_IDS,
  ...PASSIVE_IDS,
  LAMP_OIL_ID,
];
export function iconPath(id: OfferId): string {
  return `icons/${id}.png`;
}
export const ICON_SIZE = 24;

/* ---------------------------- Debug surface ------------------------------- */
// specs/instrumentation.md.

export const WICK_DEBUG_VERSION = 1;

/**
 * A posed angle, `setNextSpawnAngle` and `setNextSwarmAngle`, is "a real number
 * of at least `0` and below `360`, measured from `+x` toward `+y`"
 * (specs/instrumentation.md, Drawn outcomes).
 */
export const POSED_ANGLE_MIN = 0;
export const POSED_ANGLE_LIMIT = 360;

/** What `setNextDrop(kind)` takes: "one of `bread`, `draft`, and `none`". */
export const NEXT_DROPS = ["bread", "draft", "none"] as const;
export type NextDrop = (typeof NEXT_DROPS)[number];

/* ------------------------------ Tolerances -------------------------------- */
// The one set of figures here the specs do not state. Each is a limit on the
// error a conformant build may honestly carry, far below any figure a check
// asserts against, and never a licence for a different behavior.

/**
 * A figure the spec states exactly, or the product of two stated figures, read
 * back from a build. A decimal figure is not an exact double, and a build may
 * form a stated product in either order, so equality is read within 1e-9:
 * six orders below the finest figure any table states (DRAFT_CHANCE, 0.005).
 */
export const FIGURE_TOLERANCE = 1e-9;

/**
 * A position, a timer, or a time integrated tick by tick. Each step of TICK_DT
 * rounds at about 1e-13 of the running value, so a run's full 36000 ticks
 * accumulate under 1e-8; 1e-6 covers that with margin and stays four orders
 * below the finest length the specs state (the 0.1 of a slash flash, in
 * seconds, and every unit-valued length).
 */
export const MOTION_TOLERANCE = 1e-6;

/**
 * A unit vector's component read back from a build, which normalizes with
 * `Math.hypot` or an equivalent of its own choosing: 1e-9, the same reading
 * as FIGURE_TOLERANCE, since a component is a quotient of two exact figures.
 */
export const DIRECTION_TOLERANCE = 1e-9;

/**
 * A position the simulation integrates over a span of ticks, read against the
 * figure the rules give it: thirty steps of `speed × TICK_DT` summed in floats
 * stray by far less than a tenth of a unit, and a build that integrated with
 * the frame's delta rather than the tick's strays by whole steps. A tenth of a
 * unit is below every figure the specification states in units.
 */
export const INTEGRATION_TOLERANCE = 0.1;

/**
 * The drop roll's sample and bounds, from specs/world.md's BREAD_CHANCE (0.02)
 * and DRAFT_CHANCE (0.005) over DROP_SAMPLE common kills. The bread count is
 * Binomial(4000, 0.02), mean 80 and deviation 8.85; a draft drops only when
 * no bread did, so the draft count is Binomial(4000, 0.98 × 0.005), mean 19.6
 * and deviation 4.42. Each bound sits where the tail past it is below one in
 * a hundred thousand, and each band is more than nine deviations wide, so a
 * conformant build fails these at most once in a hundred thousand runs while
 * a build that never drops, or drops on every kill, fails them every time.
 */
export const DROP_SAMPLE = 4000;
export const BREAD_COUNT_RANGE: readonly [number, number] = [40, 125];
export const DRAFT_COUNT_RANGE: readonly [number, number] = [3, 45];

/**
 * How far into a bar's fill a "scales with" reading is trusted: a bar whose
 * filled width scales with a ratio reads that ratio within a fifth of the full
 * width. specs/ui.md fixes the scaling and no pixel geometry, so a check that
 * measures a bar's filled extent at two poses compares the ratio of the two
 * extents against the ratio of the two values within this share, which admits
 * any border, rounding, or end-cap a build draws and refuses a bar that does
 * not move with its value.
 */
export const BAR_SHARE_TOLERANCE = 0.2;

/**
 * How far the left edge of one band of a bar may sit from the left edge of
 * another band of the same bar, as a share of that bar's full width: a
 * fiftieth.
 *
 * specs/ui.md draws each bar "filled from its left edge, its filled width
 * `hp / maxHp` of the bar's width", so two fills of one bar read against the
 * SAME lower fill both begin where that lower fill ends, and the two bands
 * share that column whatever border, rounding, or end-cap a build draws around
 * its fill. A fiftieth of the width admits a build that antialiases one fill's
 * right edge differently from the other's, and stays an order below the fifth
 * of a width a bar anchored on its right edge, or one that empties as its value
 * rises, displaces the second band by.
 */
export const BAR_EDGE_TOLERANCE = 0.02;

/**
 * A `KeyboardEvent.code` bound to no action (specs/controls.md binds eight
 * codes), used to give the engine the gesture that unlocks its audio without
 * driving the game.
 */
export const UNBOUND_KEY = "F24";

/**
 * Where a drawn sprite's center, or a drawn tile's corner, is read back on the
 * stage against the point the camera formula of specs/world.md gives it. A
 * build may snap a sprite to whole device pixels to keep pixel art crisp, and
 * the harness's device mapping rounds once more, so a drawn point is read
 * within 1 unit. The smallest produced sprite is 8 units across, so one unit
 * cannot attribute a blit to a neighbour, and a sprite anchored on its edge
 * rather than its center, or a camera that lags the lamplighter by a single
 * tick, misses by 3 units or more.
 */
export const DRAWN_POINT_TOLERANCE = 1;

/* ---- What the specification leaves to the build -------------------------- */
//
// The one value this project reads off the build rather than restating from the
// specs, re-exported here so the project has a single import site for it. It is
// read to drive the build and to name the subject of a check, never compared
// against a figure of the case's own.
//
// specs/overview.md fixes only that "`src/game.ts` also exports `BACKGROUND`, a
// CSS color string: the stage background", that `src/main.ts` "hands it to the
// engine as the color the canvas is cleared to each frame, so the letterbox
// bars around the stage match the night", and specs/ui.md that "Wick fixes no
// palette". Which color it is is therefore the build's own choice: the harness
// stands the engine up with it the way the page does, and the letterbox check
// asserts that the bars really carry it.

export { BACKGROUND } from "../src/game";
