// Wick — the figures this case's specification fixes. CASE-PROVIDED.
//
// Under an engine the same numbers reach a validator from `src/constants.ts`,
// which is SEEDED into the run: the case hands the build the module and the
// checks import it back. An engineless run seeds no `src/` at all — the build
// writes every module it has, including whichever one it chooses to name these
// figures in — so there is nothing for a check to import, and the values have to
// live on the validator's side of the line.
//
// So this file is that side, and it is the ONE PLACE a threshold is written. A
// suite next door imports the bound it asserts from here rather than spelling a
// number of its own, so a figure appears once and every point that turns on it
// reads the same value.
//
// EVERY VALUE BELOW IS STATED BY THE SEEDED SPECIFICATION, and each carries the
// spec file and the sentence or table it came from. NOTHING here is read off the
// reference implementation: a validator that enshrined a value the specs leave
// open would fail a build that satisfies every stated requirement, which is
// worse than no validator at all. Where the specification leaves a choice — the
// palette, the sprites' look, the layout, the fonts, the how-to copy's wording —
// this file holds no value, because there is nothing to hold.
//
// Every position and distance is in world units, which are the units of the
// fixed 1280 x 720 logical stage (`specs/overview.md`: origin top-left, x right,
// y down, the world an unbounded plane with the same axes whose origin is where
// a run began); every rate is per second; every duration is in seconds; and
// every angle is in degrees measured from `+x` and increasing toward `+y`.

/* -------------------------------------------------------------------------- */
/* The stage and the world (specs/overview.md — "Units, ticks, the world")    */
/* -------------------------------------------------------------------------- */

/** "a fixed logical stage of `STAGE_W x STAGE_H` (`1280 x 720`, 16:9)". */
export const STAGE_W = 1280;
export const STAGE_H = 720;

/** "with its center at `(STAGE_CX, STAGE_CY)` (`640, 360`)". */
export const STAGE_CX = 640;
export const STAGE_CY = 360;

/* -------------------------------------------------------------------------- */
/* The clock (specs/overview.md, specs/instrumentation.md, specs/world.md)     */
/* -------------------------------------------------------------------------- */

/** "a fixed tick of `TICK_HZ` (`60`) ticks per second". */
export const TICK_HZ = 60;

/** "each `TICK_DT` (`1/60`) seconds long". */
export const TICK_DT = 1 / TICK_HZ;

/** Milliseconds of simulated time in one tick, for a recording's frame deltas. */
export const TICK_MS = 1000 / TICK_HZ;

/**
 * "A tick is consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`,
 * with `TICK_EPSILON` (`1e-9`) seconds" (specs/instrumentation.md).
 */
export const TICK_EPSILON = 1e-9;

/** "`DAWN_TIME` (`600`) seconds is the length of the night" (specs/world.md). */
export const DAWN_TIME = 600;

/** "Dawn | `tick` equals `DAWN_TIME × TICK_HZ` (`36000`)" (specs/world.md). */
export const DAWN_TICK = DAWN_TIME * TICK_HZ;

/**
 * The greatest tick `setTick` accepts: "a whole number from `0` to
 * `DAWN_TIME × TICK_HZ − 1` (`35999`)" (specs/instrumentation.md).
 */
export const MAX_POSED_TICK = DAWN_TICK - 1;

/**
 * The ticks after which a timer set to `seconds` is due.
 *
 * specs/world.md — "Timers": "a timer set to `s` seconds is due
 * `round(s × TICK_HZ)` ticks after the tick it was set on ... An interval of
 * `s` seconds anywhere in this specification is likewise `round(s × TICK_HZ)`
 * ticks." The shared harness's `ticks()` rounds UP, which is a different rule,
 * so every suite counts with this one.
 */
export function dueTicks(seconds: number): number {
  return Math.round(seconds * TICK_HZ);
}

/* -------------------------------------------------------------------------- */
/* The surface (specs/instrumentation.md)                                     */
/* -------------------------------------------------------------------------- */

/** "Wick carries a small debugging and automation surface, `window.__wick`". */
export const HANDLE = "__wick";

/** "The surface carries `version` (`WICK_DEBUG_VERSION`, `1`), a plain number". */
export const WICK_DEBUG_VERSION = 1;

/** "`options.seed` seeds the generator, defaulting to `DEFAULT_SEED` (`1`)". */
export const DEFAULT_SEED = 1;

/** A seed is "a whole number from `0` to `2^32 − 1`". */
export const MAX_SEED = 2 ** 32 - 1;

/**
 * The nine screens, as `snapshot().screen` names them (specs/ui.md — "Screens").
 */
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

export type ScreenName = (typeof SCREENS)[number];

/** "'A run screen' below means `playing` or `paused`." */
export const RUN_SCREENS = ["playing", "paused"] as const;

/**
 * The seven driver switches, in the order the table in "The driver switches"
 * lists them, each "reported by the snapshot under the same name".
 */
export const SWITCH_NAMES = [
  "spawning",
  "events",
  "despawning",
  "enemyMotion",
  "enemyContact",
  "weaponFire",
  "effectMotion",
] as const;

export type SwitchName = (typeof SWITCH_NAMES)[number];

/** The operation that sets each switch. */
export const SWITCH_OPS: Readonly<Record<SwitchName, string>> = {
  spawning: "setSpawning",
  events: "setEvents",
  despawning: "setDespawning",
  enemyMotion: "setEnemyMotion",
  enemyContact: "setEnemyContact",
  weaponFire: "setWeaponFire",
  effectMotion: "setEffectMotion",
};

/**
 * Every operation `specs/instrumentation.md` requires of `window.__wick`, in the
 * order that file lists them. `version` is a property rather than an operation,
 * and is checked separately.
 */
export const REQUIRED_OPS: readonly string[] = [
  // Core
  "setAutoStep",
  "step",
  "advance",
  "reset",
  "snapshot",
  // Screens
  "setScreen",
  "choose",
  // Menus
  "menuRects",
  "tabRects",
  // The driver switches
  "setSpawning",
  "setEvents",
  "setDespawning",
  "setEnemyMotion",
  "setEnemyContact",
  "setWeaponFire",
  "setEffectMotion",
  // The clock
  "setTick",
  "setSpawnTimer",
  // The lamplighter
  "setPlayerPosition",
  "setFacing",
  "setHp",
  // Progression
  "setLevel",
  "setXp",
  "setKills",
  "setPendingLevelUps",
  "setNextOffers",
  // The loadout
  "setWeapon",
  "setWeaponCooldown",
  "removeWeapon",
  "setPassive",
  "removePassive",
  // Enemies
  "spawnEnemy",
  "setEnemyPosition",
  "setEnemyHp",
  "setEnemyHeading",
  "setEnemyAge",
  "setEnemyContactCooldown",
  "removeEnemy",
  "clearEnemies",
  // Projectiles and zones
  "spawnProjectile",
  "clearProjectiles",
  "spawnPuddle",
  "clearZones",
  // Gems and pickups
  "spawnGem",
  "setGemAttracted",
  "clearGems",
  "spawnPickup",
  "clearPickups",
];

/* -------------------------------------------------------------------------- */
/* Controls (specs/controls.md — "Actions and bindings")                       */
/* -------------------------------------------------------------------------- */

/** "`ACTIONS` holds the eight actions the game registers". */
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

export type Action = (typeof ACTIONS)[number];

/** "`BINDINGS` maps each to the `KeyboardEvent.code` values that fire it." */
export const BINDINGS: Readonly<Record<Action, readonly string[]>> = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP"],
  mute: ["KeyM"],
};

/** "The diagnostics overlay toggles on `Backquote`, outside the action registry." */
export const OVERLAY_KEY = "Backquote";

/** "`LAYOUT` (`dpad-4`) names the control scheme". */
export const LAYOUT = "dpad-4";

/**
 * A key `BINDINGS` binds to nothing and the overlay does not use, so pressing it
 * changes no game state. The harness presses it to give the build the genuine
 * browser gesture its audio needs (specs/ui.md: "the first-interaction unlock
 * belong[s] to the runtime").
 */
export const UNBOUND_KEY = "KeyZ";

/* ---- The pointer (specs/controls.md — "The pointer") --------------------- */
//
// "The pointer is read in the stage's own coordinates, `0` to `STAGE_W` across
// and `0` to `STAGE_H` down, whatever the canvas's size on the page and wherever
// the letterbox bars fall, and wheel travel is read in those same units." So a
// check names a point in the same units it names a sprite's position in, and the
// harness carries it through the page's fit.

/**
 * "A frame's travel is that frame's wheel deltas summed in stage units, divided
 * by `WHEEL_ROW` (`100`) and truncated toward zero to give the number of rows
 * `almanacScroll` moves".
 */
export const WHEEL_ROW = 100;

/**
 * "Every screen that shows a vertical menu answers the pointer: `title`,
 * `almanac`, `levelup`, `paused`, `fallen`, and `dawn`."
 */
export const MENU_SCREENS: readonly ScreenName[] = [
  "title",
  "almanac",
  "levelup",
  "paused",
  "fallen",
  "dawn",
];

/**
 * The three screens with no vertical menu: "`howto`, `playing`, and `chest`
 * report an empty list" (specs/instrumentation.md — `menuRects`).
 */
export const MENULESS_SCREENS: readonly ScreenName[] = [
  "howto",
  "playing",
  "chest",
];

/* -------------------------------------------------------------------------- */
/* The lamplighter (specs/world.md — "The lamplighter", "Contact damage")      */
/* -------------------------------------------------------------------------- */

/** "Base move speed, units per second | `MOVE_SPEED` | `180`". */
export const MOVE_SPEED = 180;

/** "Collision radius | `PLAYER_RADIUS` | `12`". */
export const PLAYER_RADIUS = 12;

/** "Base maximum health | `BASE_MAX_HP` | `100`". */
export const BASE_MAX_HP = 100;

/** "Base recovery, health per second | `BASE_RECOVERY` | `0`". */
export const BASE_RECOVERY = 0;

/** "Base pickup radius | `PICKUP_RADIUS` | `48`". */
export const PICKUP_RADIUS = 48;

/** "Seconds between hits by one enemy | `CONTACT_COOLDOWN` | `0.5`". */
export const CONTACT_COOLDOWN = 0.5;

/** "Least health a hit removes | `MIN_DAMAGE_TAKEN` | `1`". */
export const MIN_DAMAGE_TAKEN = 1;

/** "Seconds the hurt flash runs | `HURT_FLASH` | `0.3`". */
export const HURT_FLASH = 0.3;

/**
 * Ticks a hurt flash runs: `HURT_FLASH` (`0.3`) seconds at `TICK_HZ` (`60`),
 * rounded, because the timer "counts down with the contact cooldowns in phase
 * 7" and every tick is `TICK_DT` long. The tick the hit lands on sets the timer,
 * so the flash is over this many ticks later.
 */
export const HURT_FLASH_TICKS = Math.round(HURT_FLASH * TICK_HZ);

export type Facing = "left" | "right";

/**
 * The step one tick of movement covers at the base speed: "each tick the
 * position advances by the velocity times `TICK_DT`", so `180 / 60` units.
 */
export const MOVE_STEP = MOVE_SPEED * TICK_DT;

/* -------------------------------------------------------------------------- */
/* Gems and pickups (specs/world.md — "Gems", "Pickups")                       */
/* -------------------------------------------------------------------------- */

/** "`GEM_TIERS` lists the three tiers in this order". */
export const GEM_TIERS = ["small", "medium", "large"] as const;

export type GemTier = (typeof GEM_TIERS)[number];

/** "`GEM_VALUES` gives the experience each grants": 1, 3, 10. */
export const GEM_VALUES: Readonly<Record<GemTier, number>> = {
  small: 1,
  medium: 3,
  large: 10,
};

/** "Flight speed, units per second | `GEM_SPEED` | `600`". */
export const GEM_SPEED = 600;

/** "Collection distance | `COLLECT_RADIUS` | `8`". */
export const COLLECT_RADIUS = 8;

/** The distance an attracted gem flies in one tick: `GEM_SPEED × TICK_DT`. */
export const GEM_STEP = GEM_SPEED * TICK_DT;

/** "`PICKUP_KINDS` lists the three kinds in this order." */
export const PICKUP_KINDS = ["chest", "bread", "draft"] as const;

export type PickupKind = (typeof PICKUP_KINDS)[number];

/** A pickup is collected within "`PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`". */
export const PICKUP_ITEM_RADIUS = 16;

/** "`bread` | ... | Heals `BREAD_HEAL` (`30`), capped at `maxHp`." */
export const BREAD_HEAL = 30;

/** "Probability a common kill drops bread | `BREAD_CHANCE` | `0.02`". */
export const BREAD_CHANCE = 0.02;

/** "Probability a common kill drops a draft | `DRAFT_CHANCE` | `0.005`". */
export const DRAFT_CHANCE = 0.005;

/** "Heal. `hp` rises by `CHEST_HEAL` (`30`), capped at `maxHp`" (specs/evolutions.md). */
export const CHEST_HEAL = 30;

/* -------------------------------------------------------------------------- */
/* Weapons (specs/weapons.md)                                                 */
/* -------------------------------------------------------------------------- */

/** "The ten base weapons are `BASE_WEAPON_IDS`, in this order". */
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

/** "the six ids are `EVOLUTION_IDS`, in this order" (specs/evolutions.md). */
export const EVOLUTION_IDS = [
  "pyre",
  "beacon",
  "hail",
  "chandelier",
  "corona",
  "blaze",
] as const;

export type EvolutionId = (typeof EVOLUTION_IDS)[number];

/** Every weapon id, base or evolved: the domain of `setWeapon`'s `id`. */
export const WEAPON_IDS = [...BASE_WEAPON_IDS, ...EVOLUTION_IDS] as const;

export type WeaponId = (typeof WEAPON_IDS)[number];

/** The display names, "in `WEAPON_NAMES`", as the two targeting tables spell them. */
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

/** "Every level table has `MAX_WEAPON_LEVEL` (`8`) rows". */
export const MAX_WEAPON_LEVEL = 8;

/** "the table cooldown times `cooldownMul`, floored at `MIN_COOLDOWN` (`0.2`)". */
export const MIN_COOLDOWN = 0.2;

/** "A projectile whose `pierce` is `INFINITE_PIERCE` (`-1`) is never lowered". */
export const INFINITE_PIERCE = -1;

/** "Any amount above `TAPER_MAX_AMOUNT` (`2`) adds nothing." */
export const TAPER_MAX_AMOUNT = 2;

/** "The slash is drawn for `SLASH_FLASH` (`0.1`) seconds." */
export const SLASH_FLASH = 0.1;

/** "`y = player.y + (i − (n − 1) / 2) × PIN_SPREAD`, with `PIN_SPREAD` (`10`)". */
export const PIN_SPREAD = 10;

/** "they revolve at `LANTERN_ANGULAR_SPEED` (`180`) degrees per second clockwise". */
export const LANTERN_ANGULAR_SPEED = 180;

/** "a touching effect with re-hit interval `LANTERN_REHIT` (`0.5`)". */
export const LANTERN_REHIT = 0.5;

/** "the disk of radius `OIL_SCATTER` (`400`) about the player's center". */
export const OIL_SCATTER = 400;

/** "A puddle is a pulsing effect with interval `OIL_PULSE` (`0.3`)". */
export const OIL_PULSE = 0.3;

/** "the live enemies within `SPARK_RANGE` (`600`) of the player's center". */
export const SPARK_RANGE = 600;

/** "The strike is drawn for `SPARK_FLASH` (`0.2`) seconds". */
export const SPARK_FLASH = 0.2;

/** "its re-hit interval is `SHARD_REHIT` (`0.5`) per shard per enemy". */
export const SHARD_REHIT = 0.5;

/** "rotated by `(i − (n − 1) / 2) × SHARD_SPREAD` degrees, with `SHARD_SPREAD` (`15`)". */
export const SHARD_SPREAD = 15;

/** "a constant acceleration of `−SCONCE_DECEL` (`600`) units per second squared". */
export const SCONCE_DECEL = 600;

/** "its re-hit interval is `SCONCE_REHIT` (`0.5`) per sconce per enemy". */
export const SCONCE_REHIT = 0.5;

/** "rotated by `(i − (n − 1) / 2) × SCONCE_SPREAD` degrees, with `SCONCE_SPREAD` (`20`)". */
export const SCONCE_SPREAD = 20;

/** "except the enemies listed in `FLARE_IMMUNE` (`["dark"]`)". */
export const FLARE_IMMUNE: readonly string[] = ["dark"];

/** "The burst is drawn for `FLARE_FLASH` (`0.4`) seconds". */
export const FLARE_FLASH = 0.4;

/**
 * One row of a level table or an evolved weapon's fixed row, with every column
 * a weapon can carry. A column a weapon's table lacks is absent.
 */
export interface WeaponRow {
  damage: number;
  /** Absent for Chandelier, which "has no cooldown". */
  cooldown?: number;
  width?: number;
  height?: number;
  speed?: number;
  radius?: number;
  orbit?: number;
  area?: number;
  pierce?: number;
  duration?: number;
  /** Absent for Halo, Corona, and Flare, which have no amount. */
  amount?: number;
}

/** "`TAPER_LEVELS`" — Damage, Cooldown, Width, Height, Amount. */
export const TAPER_LEVELS: readonly WeaponRow[] = [
  { damage: 10, cooldown: 1.35, width: 120, height: 40, amount: 1 },
  { damage: 15, cooldown: 1.35, width: 120, height: 40, amount: 1 },
  { damage: 15, cooldown: 1.35, width: 120, height: 40, amount: 2 },
  { damage: 15, cooldown: 1.35, width: 140, height: 48, amount: 2 },
  { damage: 20, cooldown: 1.35, width: 140, height: 48, amount: 2 },
  { damage: 20, cooldown: 1.2, width: 140, height: 48, amount: 2 },
  { damage: 25, cooldown: 1.2, width: 140, height: 48, amount: 2 },
  { damage: 30, cooldown: 1.2, width: 160, height: 56, amount: 2 },
];

/** "`EMBER_LEVELS`" — Damage, Cooldown, Speed, Radius, Pierce, Duration, Amount. */
export const EMBER_LEVELS: readonly WeaponRow[] = [
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

/** "`PIN_LEVELS`" — Damage, Cooldown, Speed, Radius, Pierce, Duration, Amount. */
export const PIN_LEVELS: readonly WeaponRow[] = [
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

/** "`LANTERN_LEVELS`" — Damage, Cooldown, Orbit, Radius, Duration, Amount. */
export const LANTERN_LEVELS: readonly WeaponRow[] = [
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

/** "`HALO_LEVELS`" — Damage, Cooldown, Radius. Halo "Amount is ignored." */
export const HALO_LEVELS: readonly WeaponRow[] = [
  { damage: 3, cooldown: 1, radius: 80 },
  { damage: 3, cooldown: 1, radius: 90 },
  { damage: 4, cooldown: 1, radius: 90 },
  { damage: 4, cooldown: 0.8, radius: 100 },
  { damage: 5, cooldown: 0.8, radius: 100 },
  { damage: 5, cooldown: 0.8, radius: 110 },
  { damage: 6, cooldown: 0.7, radius: 110 },
  { damage: 8, cooldown: 0.6, radius: 120 },
];

/** "`OIL_SPLASH_LEVELS`" — Damage, Cooldown, Radius, Duration, Amount. */
export const OIL_SPLASH_LEVELS: readonly WeaponRow[] = [
  { damage: 4, cooldown: 3, radius: 50, duration: 2.5, amount: 1 },
  { damage: 4, cooldown: 3, radius: 50, duration: 2.5, amount: 2 },
  { damage: 5, cooldown: 3, radius: 55, duration: 2.5, amount: 2 },
  { damage: 5, cooldown: 2.5, radius: 55, duration: 3, amount: 2 },
  { damage: 6, cooldown: 2.5, radius: 60, duration: 3, amount: 3 },
  { damage: 6, cooldown: 2.5, radius: 60, duration: 3.5, amount: 3 },
  { damage: 7, cooldown: 2, radius: 65, duration: 3.5, amount: 3 },
  { damage: 8, cooldown: 2, radius: 70, duration: 4, amount: 4 },
];

/** "`SPARK_LEVELS`" — Damage, Cooldown, Area, Amount. */
export const SPARK_LEVELS: readonly WeaponRow[] = [
  { damage: 15, cooldown: 2, area: 40, amount: 1 },
  { damage: 15, cooldown: 2, area: 40, amount: 2 },
  { damage: 20, cooldown: 2, area: 40, amount: 2 },
  { damage: 20, cooldown: 1.8, area: 50, amount: 2 },
  { damage: 25, cooldown: 1.8, area: 50, amount: 3 },
  { damage: 25, cooldown: 1.6, area: 50, amount: 3 },
  { damage: 30, cooldown: 1.6, area: 60, amount: 3 },
  { damage: 40, cooldown: 1.4, area: 70, amount: 4 },
];

/** "`SHARD_LEVELS`" — Damage, Cooldown, Speed, Radius, Duration, Amount. Pierce is infinite. */
export const SHARD_LEVELS: readonly WeaponRow[] = [
  {
    damage: 8,
    cooldown: 2.5,
    speed: 500,
    radius: 8,
    pierce: INFINITE_PIERCE,
    duration: 3,
    amount: 1,
  },
  {
    damage: 8,
    cooldown: 2.5,
    speed: 500,
    radius: 8,
    pierce: INFINITE_PIERCE,
    duration: 3.5,
    amount: 1,
  },
  {
    damage: 10,
    cooldown: 2.5,
    speed: 500,
    radius: 8,
    pierce: INFINITE_PIERCE,
    duration: 3.5,
    amount: 2,
  },
  {
    damage: 10,
    cooldown: 2.2,
    speed: 500,
    radius: 8,
    pierce: INFINITE_PIERCE,
    duration: 4,
    amount: 2,
  },
  {
    damage: 12,
    cooldown: 2.2,
    speed: 500,
    radius: 8,
    pierce: INFINITE_PIERCE,
    duration: 4,
    amount: 2,
  },
  {
    damage: 12,
    cooldown: 2,
    speed: 550,
    radius: 9,
    pierce: INFINITE_PIERCE,
    duration: 4.5,
    amount: 3,
  },
  {
    damage: 15,
    cooldown: 2,
    speed: 550,
    radius: 9,
    pierce: INFINITE_PIERCE,
    duration: 4.5,
    amount: 3,
  },
  {
    damage: 20,
    cooldown: 1.8,
    speed: 600,
    radius: 10,
    pierce: INFINITE_PIERCE,
    duration: 5,
    amount: 3,
  },
];

/** "`SCONCE_LEVELS`" — Damage, Cooldown, Speed, Radius, Duration, Amount. Pierce is infinite. */
export const SCONCE_LEVELS: readonly WeaponRow[] = [
  {
    damage: 12,
    cooldown: 2,
    speed: 600,
    radius: 12,
    pierce: INFINITE_PIERCE,
    duration: 2.5,
    amount: 1,
  },
  {
    damage: 12,
    cooldown: 2,
    speed: 600,
    radius: 12,
    pierce: INFINITE_PIERCE,
    duration: 2.5,
    amount: 2,
  },
  {
    damage: 16,
    cooldown: 2,
    speed: 600,
    radius: 12,
    pierce: INFINITE_PIERCE,
    duration: 2.5,
    amount: 2,
  },
  {
    damage: 16,
    cooldown: 1.8,
    speed: 600,
    radius: 14,
    pierce: INFINITE_PIERCE,
    duration: 2.5,
    amount: 2,
  },
  {
    damage: 20,
    cooldown: 1.8,
    speed: 600,
    radius: 14,
    pierce: INFINITE_PIERCE,
    duration: 2.5,
    amount: 3,
  },
  {
    damage: 20,
    cooldown: 1.6,
    speed: 600,
    radius: 14,
    pierce: INFINITE_PIERCE,
    duration: 2.5,
    amount: 3,
  },
  {
    damage: 24,
    cooldown: 1.6,
    speed: 600,
    radius: 16,
    pierce: INFINITE_PIERCE,
    duration: 2.5,
    amount: 3,
  },
  {
    damage: 30,
    cooldown: 1.4,
    speed: 600,
    radius: 16,
    pierce: INFINITE_PIERCE,
    duration: 2.5,
    amount: 4,
  },
];

/** "`FLARE_LEVELS`" — Damage, Cooldown, Radius. Flare "amount is ignored". */
export const FLARE_LEVELS: readonly WeaponRow[] = [
  { damage: 100, cooldown: 60, radius: 640 },
  { damage: 100, cooldown: 55, radius: 640 },
  { damage: 150, cooldown: 55, radius: 640 },
  { damage: 150, cooldown: 50, radius: 640 },
  { damage: 200, cooldown: 50, radius: 640 },
  { damage: 200, cooldown: 45, radius: 640 },
  { damage: 300, cooldown: 45, radius: 640 },
  { damage: 500, cooldown: 40, radius: 640 },
];

/** The ten tables "collected by id in `WEAPON_LEVELS`". */
export const WEAPON_LEVELS: Readonly<
  Record<BaseWeaponId, readonly WeaponRow[]>
> = {
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

/** "The fixed row is `PYRE_STATS`" — Damage, Cooldown, Width, Height, Amount. */
export const PYRE_STATS: WeaponRow = {
  damage: 60,
  cooldown: 1.2,
  width: 200,
  height: 60,
  amount: 2,
};

/** "`BEACON_STATS`" — Damage, Cooldown, Speed, Radius, Pierce, Duration, Amount. */
export const BEACON_STATS: WeaponRow = {
  damage: 20,
  cooldown: 0.25,
  speed: 500,
  radius: 10,
  pierce: 2,
  duration: 2,
  amount: 1,
};

/** "`HAIL_STATS`" — Damage, Cooldown, Speed, Radius, Pierce, Duration, Amount. */
export const HAIL_STATS: WeaponRow = {
  damage: 15,
  cooldown: 0.5,
  speed: 700,
  radius: 7,
  pierce: 3,
  duration: 1.5,
  amount: 6,
};

/** "`CHANDELIER_STATS`" — Damage, Orbit, Radius, Amount; "it has no cooldown and no duration". */
export const CHANDELIER_STATS: WeaponRow = {
  damage: 25,
  orbit: 120,
  radius: 20,
  amount: 4,
};

/** "`CORONA_STATS`, where the cooldown is the pulse interval" — Damage, Cooldown, Radius. */
export const CORONA_STATS: WeaponRow = {
  damage: 12,
  cooldown: 0.5,
  radius: 150,
};

/** "`BLAZE_STATS`" — Damage, Cooldown, Radius, Duration, Amount. */
export const BLAZE_STATS: WeaponRow = {
  damage: 8,
  cooldown: 2,
  radius: 70,
  duration: 4,
  amount: 5,
};

/** The six evolved rows by id. */
export const EVOLUTION_STATS: Readonly<Record<EvolutionId, WeaponRow>> = {
  pyre: PYRE_STATS,
  beacon: BEACON_STATS,
  hail: HAIL_STATS,
  chandelier: CHANDELIER_STATS,
  corona: CORONA_STATS,
  blaze: BLAZE_STATS,
};

/**
 * The row a weapon reads at `level`: row `level − 1` of a base weapon's table
 * ("row `i` is level `i + 1`"), or the single fixed row of an evolved weapon.
 */
export function weaponRow(id: WeaponId, level = 1): WeaponRow {
  if (isEvolutionId(id)) return EVOLUTION_STATS[id];
  const table = WEAPON_LEVELS[id];
  const index = Math.min(Math.max(Math.round(level), 1), MAX_WEAPON_LEVEL) - 1;
  return table[index] as WeaponRow;
}

/** Whether `id` names one of the six evolved weapons. */
export function isEvolutionId(id: string): id is EvolutionId {
  return (EVOLUTION_IDS as readonly string[]).includes(id);
}

/** Whether `id` names one of the ten base weapons. */
export function isBaseWeaponId(id: string): id is BaseWeaponId {
  return (BASE_WEAPON_IDS as readonly string[]).includes(id);
}

/**
 * "The recipes are `EVOLUTIONS`, keyed by the evolved weapon's id"
 * (specs/evolutions.md — "The recipe"): the base it comes from and the passive
 * the recipe names.
 */
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

/** The evolved form of a base weapon, or `null` for the four that have none. */
export function evolutionOf(base: BaseWeaponId): EvolutionId | null {
  for (const id of EVOLUTION_IDS) {
    if (EVOLUTIONS[id].from === base) return id;
  }
  return null;
}

/** "Each enemy a Pyre slash hits heals the player `PYRE_HEAL` (`1`) health". */
export const PYRE_HEAL = 1;

/** "Each enemy a pulse kills ... heals the player `CORONA_HEAL` (`1`) health". */
export const CORONA_HEAL = 1;

/** "A Blaze puddle is a pulsing effect with interval `BLAZE_PULSE` (`0.2`)". */
export const BLAZE_PULSE = 0.2;

/**
 * The weapons `spawnProjectile` accepts: "one of `ember`, `pin`, `shard`,
 * `sconce`, `beacon`, and `hail`" (specs/instrumentation.md).
 */
export const PROJECTILE_WEAPONS = [
  "ember",
  "pin",
  "shard",
  "sconce",
  "beacon",
  "hail",
] as const;

export type ProjectileWeapon = (typeof PROJECTILE_WEAPONS)[number];

/** The weapons `spawnPuddle` accepts: "one of `oil-splash` and `blaze`". */
export const PUDDLE_WEAPONS = ["oil-splash", "blaze"] as const;

export type PuddleWeapon = (typeof PUDDLE_WEAPONS)[number];

/** A zone's kind (specs/state.md): `puddle`, `lantern`, `aura`, `slash`, `strike`, or `burst`. */
export const ZONE_KINDS = [
  "puddle",
  "lantern",
  "aura",
  "slash",
  "strike",
  "burst",
] as const;

export type ZoneKind = (typeof ZONE_KINDS)[number];

/**
 * "A weapon marked as needing a target does not fire without one" — the
 * targeting summary's last column, and the same for the evolved forms
 * (specs/evolutions.md: Beacon "needs at least one enemy to fire").
 */
export const NEEDS_TARGET: readonly WeaponId[] = [
  "ember",
  "spark",
  "sconce",
  "beacon",
];

/** The re-hit interval of each touching effect, and the pulse interval of each pulsing one. */
export const REHIT_INTERVALS: Readonly<Partial<Record<WeaponId, number>>> = {
  lantern: LANTERN_REHIT,
  chandelier: LANTERN_REHIT,
  shard: SHARD_REHIT,
  sconce: SCONCE_REHIT,
  "oil-splash": OIL_PULSE,
  blaze: BLAZE_PULSE,
};

/* -------------------------------------------------------------------------- */
/* Passives and derived stats (specs/passives.md)                              */
/* -------------------------------------------------------------------------- */

/** "`PASSIVE_IDS` lists the ten in this order". */
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

/** "`PASSIVES` gives each one its display name and its max level." */
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

/** Whether `id` names one of the ten passives. */
export function isPassiveId(id: string): id is PassiveId {
  return (PASSIVE_IDS as readonly string[]).includes(id);
}

/** "Wick damage | `WICK_DAMAGE_PER_LEVEL` | `0.1`". */
export const WICK_DAMAGE_PER_LEVEL = 0.1;
/** "Oil cooldown | `OIL_COOLDOWN_PER_LEVEL` | `0.08`". */
export const OIL_COOLDOWN_PER_LEVEL = 0.08;
/** "Glass area | `GLASS_AREA_PER_LEVEL` | `0.1`". */
export const GLASS_AREA_PER_LEVEL = 0.1;
/** "Brass armor | `BRASS_ARMOR_PER_LEVEL` | `1`". */
export const BRASS_ARMOR_PER_LEVEL = 1;
/** "Mirror amount | `MIRROR_AMOUNT_PER_LEVEL` | `1`". */
export const MIRROR_AMOUNT_PER_LEVEL = 1;
/** "Bellows speed | `BELLOWS_SPEED_PER_LEVEL` | `0.1`". */
export const BELLOWS_SPEED_PER_LEVEL = 0.1;
/** "Tallow health | `TALLOW_HP_PER_LEVEL` | `15`". */
export const TALLOW_HP_PER_LEVEL = 15;
/** "Tinder recovery | `TINDER_RECOVERY_PER_LEVEL` | `0.5`". */
export const TINDER_RECOVERY_PER_LEVEL = 0.5;
/** "Soot experience | `SOOT_XP_PER_LEVEL` | `0.1`". */
export const SOOT_XP_PER_LEVEL = 0.1;
/** "Lure pickup | `LURE_PICKUP_PER_LEVEL` | `0.25`". */
export const LURE_PICKUP_PER_LEVEL = 0.25;

/**
 * The levels held, by passive id; "a passive not held is level `0`". A check
 * builds one from the loadout it posed and reads the derived stats off it.
 */
export type PassiveLevels = Partial<Record<PassiveId, number>>;

const held = (levels: PassiveLevels, id: PassiveId): number => levels[id] ?? 0;

/** `damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick`. */
export function damageMul(levels: PassiveLevels): number {
  return 1 + WICK_DAMAGE_PER_LEVEL * held(levels, "wick");
}

/** `cooldownMul = 1 − OIL_COOLDOWN_PER_LEVEL × oil`. */
export function cooldownMul(levels: PassiveLevels): number {
  return 1 - OIL_COOLDOWN_PER_LEVEL * held(levels, "oil");
}

/** `areaMul = 1 + GLASS_AREA_PER_LEVEL × glass`. */
export function areaMul(levels: PassiveLevels): number {
  return 1 + GLASS_AREA_PER_LEVEL * held(levels, "glass");
}

/** `armor = BRASS_ARMOR_PER_LEVEL × brass`. */
export function armorOf(levels: PassiveLevels): number {
  return BRASS_ARMOR_PER_LEVEL * held(levels, "brass");
}

/** `amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`. */
export function amountBonus(levels: PassiveLevels): number {
  return MIRROR_AMOUNT_PER_LEVEL * held(levels, "mirror");
}

/** `speedMul = 1 + BELLOWS_SPEED_PER_LEVEL × bellows`. */
export function speedMul(levels: PassiveLevels): number {
  return 1 + BELLOWS_SPEED_PER_LEVEL * held(levels, "bellows");
}

/** `maxHp = BASE_MAX_HP + TALLOW_HP_PER_LEVEL × tallow`. */
export function maxHpOf(levels: PassiveLevels): number {
  return BASE_MAX_HP + TALLOW_HP_PER_LEVEL * held(levels, "tallow");
}

/** `recovery = BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL × tinder`. */
export function recoveryOf(levels: PassiveLevels): number {
  return BASE_RECOVERY + TINDER_RECOVERY_PER_LEVEL * held(levels, "tinder");
}

/** `xpMul = 1 + SOOT_XP_PER_LEVEL × soot`. */
export function xpMul(levels: PassiveLevels): number {
  return 1 + SOOT_XP_PER_LEVEL * held(levels, "soot");
}

/** `pickupMul = 1 + LURE_PICKUP_PER_LEVEL × lure`. */
export function pickupMul(levels: PassiveLevels): number {
  return 1 + LURE_PICKUP_PER_LEVEL * held(levels, "lure");
}

/** "The lamplighter's move speed is `MOVE_SPEED` (`180`) times `speedMul`". */
export function moveSpeedOf(levels: PassiveLevels): number {
  return MOVE_SPEED * speedMul(levels);
}

/** "The radius within which a gem becomes attracted is `PICKUP_RADIUS` (`48`) times `pickupMul`". */
export function pickupRadiusOf(levels: PassiveLevels): number {
  return PICKUP_RADIUS * pickupMul(levels);
}

/** "`cooldown = max(MIN_COOLDOWN, table cooldown × cooldownMul)`". */
export function effectiveCooldown(
  tableCooldown: number,
  levels: PassiveLevels,
): number {
  return Math.max(MIN_COOLDOWN, tableCooldown * cooldownMul(levels));
}

/** "`damage taken = max(MIN_DAMAGE_TAKEN, enemy damage − armor)`". */
export function damageTaken(enemyDamage: number, armor: number): number {
  return Math.max(MIN_DAMAGE_TAKEN, enemyDamage - armor);
}

/* -------------------------------------------------------------------------- */
/* Progression (specs/progression.md)                                         */
/* -------------------------------------------------------------------------- */

/** "Weapon slots | `WEAPON_SLOTS` | `6`". */
export const WEAPON_SLOTS = 6;

/** "Passive slots | `PASSIVE_SLOTS` | `6`". */
export const PASSIVE_SLOTS = 6;

/** "Experience to leave level 1 | `XP_BASE` | `5`". */
export const XP_BASE = 5;

/** "Increase per level | `XP_STEP` | `10`". */
export const XP_STEP = 10;

/** "`xpToNext(level) = XP_BASE + XP_STEP × (level - 1)`". */
export function xpToNext(level: number): number {
  return XP_BASE + XP_STEP * (level - 1);
}

/** "Offers per overlay | `OFFER_COUNT` | `3`". */
export const OFFER_COUNT = 3;

/** "The fallback offer's id | `LAMP_OIL_ID` | `lamp-oil`". */
export const LAMP_OIL_ID = "lamp-oil";

/** "Its display name | `LAMP_OIL_NAME` | `Lamp Oil`". */
export const LAMP_OIL_NAME = "Lamp Oil";

/** "Health it restores | `LAMP_OIL_HEAL` | `30`". */
export const LAMP_OIL_HEAL = 30;

/** What an offer may name: a weapon id, a passive id, or lamp oil. */
export type OfferId = WeaponId | PassiveId | typeof LAMP_OIL_ID;

/** Every id `setNextOffers` accepts: "a weapon id, base or evolved, a passive id, or `LAMP_OIL_ID`". */
export const OFFER_IDS: readonly OfferId[] = [
  ...WEAPON_IDS,
  ...PASSIVE_IDS,
  LAMP_OIL_ID,
];

/* -------------------------------------------------------------------------- */
/* Enemies (specs/enemies.md)                                                 */
/* -------------------------------------------------------------------------- */

/** "`ENEMY_IDS` lists the thirteen ids in this order". */
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

/** One row of the roster, as the two tables state it. */
export interface EnemyRow {
  name: string;
  rank: EnemyRank;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  /** The gem a common drops; `"chest"` for an elite; `null` for the Dark. */
  drop: GemTier | "chest" | null;
  behavior: EnemyBehavior;
}

/** "`ENEMIES` holds each one's row by id." */
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

/** The ten ids of rank `common`, in roster order. */
export const COMMON_ENEMY_IDS: readonly EnemyId[] = ENEMY_IDS.filter(
  (id) => ENEMIES[id].rank === "common",
);

/** The two elites and the Dark, which "stand outside the spawn cap". */
export const UNCAPPED_ENEMY_IDS: readonly EnemyId[] = [
  "mothwing",
  "owl",
  "dark",
];

/** Whether `id` names one of the thirteen enemies. */
export function isEnemyId(id: string): id is EnemyId {
  return (ENEMY_IDS as readonly string[]).includes(id);
}

/** "`hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)`" with `0.15`. */
export const HP_SCALE_PER_MINUTE = 0.15;

/** The health multiplier of a common enemy spawned at run clock `time`. */
export function hpMul(time: number): number {
  return 1 + HP_SCALE_PER_MINUTE * Math.floor(time / 60);
}

/** "`WISP_AMPLITUDE` (`40`) units". */
export const WISP_AMPLITUDE = 40;

/** "`WISP_PERIOD` (`1.0`) seconds". */
export const WISP_PERIOD = 1.0;

/** "`offset(age) = WISP_AMPLITUDE * sin(2 * PI * age / WISP_PERIOD)`". */
export function wispOffset(age: number): number {
  return WISP_AMPLITUDE * Math.sin((2 * Math.PI * age) / WISP_PERIOD);
}

/** "A spawn point is `SPAWN_DISTANCE` (`760`) units from the lamplighter's center". */
export const SPAWN_DISTANCE = 760;

/** "every common enemy whose center is farther than `DESPAWN_DISTANCE` (`1200`) units". */
export const DESPAWN_DISTANCE = 1200;

/** "The night is divided into windows of `SPAWN_WINDOW` (`30`) seconds". */
export const SPAWN_WINDOW = 30;

/** "the current window's index is `min(19, floor(time / SPAWN_WINDOW))`". */
export function spawnWindowIndex(time: number): number {
  return Math.min(19, Math.floor(time / SPAWN_WINDOW));
}

/** One row of `SPAWN_WINDOWS`: the types, the seconds between spawns, the cap. */
export interface SpawnWindowRow {
  types: readonly EnemyId[];
  interval: number;
  cap: number;
}

/** "`SPAWN_WINDOWS` holds one row per window in this order". */
export const SPAWN_WINDOWS: readonly SpawnWindowRow[] = [
  { types: ["moth"], interval: 1.0, cap: 20 },
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

/** The first tick of window `index`: `index × SPAWN_WINDOW × TICK_HZ`. */
export function windowStartTick(index: number): number {
  return index * SPAWN_WINDOW * TICK_HZ;
}

export type EventKind = "swarm" | "mothwing" | "owl" | "dark";

/** One scripted event: its run-clock second and what it spawns. */
export interface ScriptedEvent {
  seconds: number;
  tick: number;
  kind: EventKind;
}

/** "`EVENTS` lists the night's scripted spawns in time order." */
export const EVENTS: readonly ScriptedEvent[] = [
  { seconds: 60, tick: 60 * TICK_HZ, kind: "swarm" },
  { seconds: 120, tick: 120 * TICK_HZ, kind: "mothwing" },
  { seconds: 240, tick: 240 * TICK_HZ, kind: "swarm" },
  { seconds: 300, tick: 300 * TICK_HZ, kind: "mothwing" },
  { seconds: 420, tick: 420 * TICK_HZ, kind: "swarm" },
  { seconds: 450, tick: 450 * TICK_HZ, kind: "owl" },
  { seconds: 540, tick: 540 * TICK_HZ, kind: "dark" },
];

/** "A gnat swarm spawns `SWARM_SIZE` (`24`) gnats on the same tick". */
export const SWARM_SIZE = 24;

/** "The line is `SWARM_LINE` (`720`) units long". */
export const SWARM_LINE = 720;

/** "`spacing = SWARM_LINE / (SWARM_SIZE - 1)`". */
export const SWARM_SPACING = SWARM_LINE / (SWARM_SIZE - 1);

/* -------------------------------------------------------------------------- */
/* Screen copy (specs/ui.md)                                                  */
/* -------------------------------------------------------------------------- */

/** "Title | `TITLE_TEXT` | `WICK`". */
export const TITLE_TEXT = "WICK";

/** "Tagline | `TAGLINE_TEXT` | `KEEP THE LIGHT`". */
export const TAGLINE_TEXT = "KEEP THE LIGHT";

/**
 * "Menu | `TITLE_ITEMS` | `LIGHT THE LAMP`, `THE ALMANAC`, `HOW TO PLAY`, in
 * that order".
 */
export const TITLE_ITEMS = [
  "LIGHT THE LAMP",
  "THE ALMANAC",
  "HOW TO PLAY",
] as const;

/** "labeled with `LEVEL_LABEL` (`LEVEL`)". */
export const LEVEL_LABEL = "LEVEL";

/** "It shows `LEVEL_UP_TEXT` (`THE LAMP BURNS BRIGHTER`)". */
export const LEVEL_UP_TEXT = "THE LAMP BURNS BRIGHTER";

/** "`OFFER_NEW_TEXT` (`NEW`)". */
export const OFFER_NEW_TEXT = "NEW";

/** "It shows `CHEST_TEXT` (`A CHEST OPENS`)". */
export const CHEST_TEXT = "A CHEST OPENS";

/** "under `PAUSED_TEXT` (`PAUSED`)". */
export const PAUSED_TEXT = "PAUSED";

/**
 * "the menu `PAUSE_ITEMS` below it: `RESUME`, `MAIN MENU`, in that order"
 * (specs/ui.md — `paused`).
 */
export const PAUSE_ITEMS = ["RESUME", "MAIN MENU"] as const;

/** "`fallen` shows `FALLEN_TEXT` (`THE LIGHT WENT OUT`)". */
export const FALLEN_TEXT = "THE LIGHT WENT OUT";

/** "`dawn` shows `DAWN_TEXT` (`DAWN`)". */
export const DAWN_TEXT = "DAWN";

/** "Menu | `END_ITEMS`: `TRY AGAIN`, `TITLE`, in that order." */
export const END_ITEMS = ["TRY AGAIN", "TITLE"] as const;

/** The howto screen names "`10:00` on the clock" as the night's end. */
export const HOWTO_DAWN_CLOCK = "10:00";

/**
 * "the controls, naming the keys `BINDINGS` gives each action: the arrows or
 * `WASD` to move, `Enter` or `Space` to confirm, `Escape` to go back, `P` to
 * pause, and `M` to mute."
 */
export const HOWTO_KEY_NAMES: readonly string[] = [
  "WASD",
  "Enter",
  "Space",
  "Escape",
  "P",
  "M",
];

/**
 * The run clock "as `m:ss`, counting up from `0:00` in whole seconds, the
 * seconds always two digits".
 */
export function clockText(tick: number): string {
  const whole = Math.floor(tick / TICK_HZ);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

/* -------------------------------------------------------------------------- */
/* The almanac (specs/ui.md — `almanac`, "Descriptions")                       */
/* -------------------------------------------------------------------------- */

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

/**
 * "The list shows `ALMANAC_ROWS` (`10`) entries at a time, beginning at the
 * entry at `almanacScroll`, and a tab of `ALMANAC_ROWS` entries or fewer shows
 * all of them."
 */
export const ALMANAC_ROWS = 10;

/** The gems' display names, as the table under `almanac` spells them. */
export const GEM_NAMES: Readonly<Record<GemTier, string>> = {
  small: "Small Gem",
  medium: "Medium Gem",
  large: "Large Gem",
};

/** The pickups' display names, as the same table spells them. */
export const PICKUP_NAMES: Readonly<Record<PickupKind, string>> = {
  chest: "Chest",
  bread: "Bread",
  draft: "Draft",
};

/* ---- The lines every entry carries --------------------------------------- */
//
// "Every tool, trinket, enemy, gem, and pickup carries one fixed line of copy,
// and the lines below are those strings exactly." Copied character for character
// from the Descriptions section of `specs/ui.md`, because the almanac and the
// level-up overlay are decided by what they DRAW and an engineless build seeds
// no constants a check could read them from.

/** "`WEAPON_DESCRIPTIONS`", the sixteen lines by weapon id. */
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

/** "`PASSIVE_DESCRIPTIONS`", the ten lines by passive id. */
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

/** "`ENEMY_DESCRIPTIONS`", the thirteen lines by enemy id. */
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

/** "`GEM_DESCRIPTIONS`", the three lines by tier. */
export const GEM_DESCRIPTIONS: Readonly<Record<GemTier, string>> = {
  small: "The experience a common death leaves behind.",
  medium: "A heavier gem, worth more toward the next level.",
  large: "The heaviest gem, left by the heaviest of the dark.",
};

/** "`PICKUP_DESCRIPTIONS`", the three lines by kind. */
export const PICKUP_DESCRIPTIONS: Readonly<Record<PickupKind, string>> = {
  chest: "Opens beside the lamp and transforms a tool at its top level.",
  bread: "Restores 30 health to the lamplighter who walks over it.",
  draft: "Draws every gem in the night to the lamp at once.",
};

/** "`LAMP_OIL_DESCRIPTION` holds lamp oil's". */
export const LAMP_OIL_DESCRIPTION = "Restores 30 health and fills no slot.";

/**
 * The line the almanac draws for an entry, and the line the level-up overlay
 * draws beneath its offer list for a weapon, a passive, or lamp oil.
 */
export function descriptionOf(id: OfferId): string {
  if (id === LAMP_OIL_ID) return LAMP_OIL_DESCRIPTION;
  if (isPassiveId(id)) return PASSIVE_DESCRIPTIONS[id];
  return WEAPON_DESCRIPTIONS[id];
}

/* ---- The tabs and their entries ------------------------------------------ */

/**
 * A stat line of an entry's detail: "each the label written exactly as it
 * appears there and its figure beside it".
 */
export interface AlmanacStat {
  label: string;
  value: number;
}

/** The labels the detail table names, spelled as `specs/ui.md` spells them. */
export const STAT_LABELS = {
  damage: "DAMAGE",
  cooldown: "COOLDOWN",
  maxLevel: "MAX LEVEL",
  health: "HEALTH",
  speed: "SPEED",
  experience: "EXPERIENCE",
  heals: "HEALS",
} as const;

/** One row of a tab's list, and the detail the highlight shows for it. */
export interface AlmanacEntry {
  /** The id in its own domain: a weapon, passive, or enemy id, a gem tier, or a pickup kind. */
  id: string;
  /** The name the row shows and the detail heads with. */
  name: string;
  /** The stat lines the detail shows, in the order the table names them. */
  stats: readonly AlmanacStat[];
  /** The entry's one line from the Descriptions section. */
  description: string;
}

/** The `TOOLS` tab: "the ten of `BASE_WEAPON_IDS`, then the six of `EVOLUTION_IDS`". */
const TOOL_ENTRIES: readonly AlmanacEntry[] = WEAPON_IDS.map((id) => {
  const row = weaponRow(id, 1);
  const stats: AlmanacStat[] = [
    { label: STAT_LABELS.damage, value: row.damage },
  ];
  // "an evolved weapon's fixed row is that row, and Chandelier, whose fixed row
  // carries no cooldown, shows `DAMAGE` alone".
  if (row.cooldown !== undefined) {
    stats.push({ label: STAT_LABELS.cooldown, value: row.cooldown });
  }
  return {
    id,
    name: WEAPON_NAMES[id],
    stats,
    description: WEAPON_DESCRIPTIONS[id],
  };
});

/** The `TRINKETS` tab: "the ten of `PASSIVE_IDS`". */
const TRINKET_ENTRIES: readonly AlmanacEntry[] = PASSIVE_IDS.map((id) => ({
  id,
  name: PASSIVES[id].name,
  stats: [{ label: STAT_LABELS.maxLevel, value: PASSIVES[id].maxLevel }],
  description: PASSIVE_DESCRIPTIONS[id],
}));

/** The `ENEMIES` tab: "the thirteen of `ENEMY_IDS`". */
const ENEMY_ENTRIES: readonly AlmanacEntry[] = ENEMY_IDS.map((id) => ({
  id,
  name: ENEMIES[id].name,
  stats: [
    { label: STAT_LABELS.health, value: ENEMIES[id].hp },
    { label: STAT_LABELS.speed, value: ENEMIES[id].speed },
    { label: STAT_LABELS.damage, value: ENEMIES[id].damage },
  ],
  description: ENEMY_DESCRIPTIONS[id],
}));

/** The `PICKUPS` tab: "the three of `GEM_TIERS`, then the three of `PICKUP_KINDS`". */
const PICKUP_ENTRIES: readonly AlmanacEntry[] = [
  ...GEM_TIERS.map((tier) => ({
    id: tier,
    name: GEM_NAMES[tier],
    stats: [{ label: STAT_LABELS.experience, value: GEM_VALUES[tier] }],
    description: GEM_DESCRIPTIONS[tier],
  })),
  ...PICKUP_KINDS.map((kind) => ({
    id: kind,
    name: PICKUP_NAMES[kind],
    // "`bread`: `HEALS` and `BREAD_HEAL` (`30`); `chest` and `draft`: none".
    stats:
      kind === "bread"
        ? [{ label: STAT_LABELS.heals, value: BREAD_HEAL }]
        : ([] as AlmanacStat[]),
    description: PICKUP_DESCRIPTIONS[kind],
  })),
];

/** Each tab's entries, in the order the tab lists them. */
export const ALMANAC_ENTRIES: Readonly<
  Record<AlmanacTab, readonly AlmanacEntry[]>
> = {
  TOOLS: TOOL_ENTRIES,
  TRINKETS: TRINKET_ENTRIES,
  ENEMIES: ENEMY_ENTRIES,
  PICKUPS: PICKUP_ENTRIES,
};

/** The entries of the tab at `almanacTab`. */
export function almanacEntries(tab: number): readonly AlmanacEntry[] {
  const name = ALMANAC_TABS[tab];
  if (name === undefined) return [];
  return ALMANAC_ENTRIES[name];
}

/** The names the tab at `almanacTab` lists, top to bottom. */
export function almanacNames(tab: number): string[] {
  return almanacEntries(tab).map((entry) => entry.name);
}

/**
 * The greatest `almanacScroll` a tab of `count` entries reaches:
 * "`almanacScroll` is held within `0` and `max(0, count − ALMANAC_ROWS)`".
 */
export function maxAlmanacScroll(count: number): number {
  return Math.max(0, count - ALMANAC_ROWS);
}

/**
 * Where `almanacScroll` lands once the highlight is at `index`: "after every
 * move of `menuIndex` it becomes the lesser of `almanacScroll` and `menuIndex`,
 * then the greater of that and `menuIndex − ALMANAC_ROWS + 1`, and is then held
 * between `0` and `max(0, count − ALMANAC_ROWS)`".
 */
export function almanacScrollFor(
  scroll: number,
  index: number,
  count: number,
): number {
  const followed = Math.max(Math.min(scroll, index), index - ALMANAC_ROWS + 1);
  return Math.min(Math.max(followed, 0), maxAlmanacScroll(count));
}

/**
 * The rows the list shows from `almanacScroll`: `ALMANAC_ROWS` of them, or
 * every remaining entry where the tab holds fewer.
 */
export function visibleAlmanacRows(count: number, scroll: number): number {
  return Math.max(0, Math.min(ALMANAC_ROWS, count - scroll));
}

/* -------------------------------------------------------------------------- */
/* Audio (specs/ui.md — "Audio", specs/assets.md — "The sound")               */
/* -------------------------------------------------------------------------- */

/** "Define and play exactly the fifteen cues in `CUES`, under exactly these names". */
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

/** "`LOOPING_CUES` holds the two cues that loop until stopped". */
export const LOOPING_CUES: readonly CueName[] = ["music", "hum"];

/** "The first thirteen are one-shot cues". */
export const ONE_SHOT_CUES: readonly CueName[] = CUE_NAMES.filter(
  (cue) => !LOOPING_CUES.includes(cue),
);

/** The file each cue plays: "`assets/audio/<cue>.wav`" for every cue, the bed included. */
export function cueFile(cue: CueName): string {
  return `assets/audio/${cue}.wav`;
}

/** "with its `assets/audio/music.mid` committed beside it". */
export const MUSIC_MIDI_FILE = "assets/audio/music.mid";

/** "it runs at least `MUSIC_MIN_SECONDS` (`30`) seconds". */
export const MUSIC_MIN_SECONDS = 30;

/** "`hum` runs at least `HUM_MIN_SECONDS` (`2`) seconds". */
export const HUM_MIN_SECONDS = 2;

/**
 * "the last sample and the first sample differ by at most
 * `LOOP_SEAM_TOLERANCE` (`0.01`) of full scale".
 */
export const LOOP_SEAM_TOLERANCE = 0.01;

/** The screens on which "`music` is looping on every frame". */
export const MUSIC_SCREENS: readonly ScreenName[] = [
  "playing",
  "levelup",
  "chest",
  "paused",
];

/** The weapons whose holding on `playing` keeps `hum` looping. */
export const HUM_WEAPONS: readonly WeaponId[] = ["halo", "corona"];

/* -------------------------------------------------------------------------- */
/* Assets (specs/assets.md)                                                   */
/* -------------------------------------------------------------------------- */

/** A produced sprite's canvas, in pixels, which is its size in units. */
export interface CanvasSize {
  width: number;
  height: number;
}

/** "Lamplighter, idle | `assets/sprites/lamplighter/idle.png` | ... | `24 x 32`". */
export const LAMPLIGHTER_SIZE: CanvasSize = { width: 24, height: 32 };
export const LAMPLIGHTER_IDLE = "assets/sprites/lamplighter/idle.png";

/** "Lamplighter, walk | `assets/sprites/lamplighter/walk/0.png` to `5.png`". */
export const LAMPLIGHTER_WALK_FRAMES = 6;
export function lamplighterWalkFrame(frame: number): string {
  return `assets/sprites/lamplighter/walk/${frame}.png`;
}

/** "Each common enemy, a walk cycle | `assets/sprites/enemies/<id>/0.png` to `3.png`" — and the elites and the Dark alike. */
export const ENEMY_WALK_FRAMES = 4;
export function enemyFrame(id: EnemyId, frame: number): string {
  return `assets/sprites/enemies/${id}/${frame}.png`;
}

/**
 * An enemy's canvas: "twice its radius in `ENEMIES`, square" for a common, and
 * `56`, `72`, `80` for Mothwing, Owl, and the Dark, which are twice their radii
 * as well.
 */
export function enemySpriteSize(id: EnemyId): CanvasSize {
  const side = 2 * ENEMIES[id].radius;
  return { width: side, height: side };
}

/** "Death puff, shared by every enemy | `assets/sprites/puff/0.png` to `3.png` | ... | `24 x 24`". */
export const PUFF_FRAMES = 4;
export const PUFF_SIZE: CanvasSize = { width: 24, height: 24 };
export function puffFrame(frame: number): string {
  return `assets/sprites/puff/${frame}.png`;
}

/** "Gems | `assets/sprites/gems/small.png`, `medium.png`, `large.png` | ... | `8 x 8`, `12 x 12`, `16 x 16`". */
export const GEM_SIZES: Readonly<Record<GemTier, CanvasSize>> = {
  small: { width: 8, height: 8 },
  medium: { width: 12, height: 12 },
  large: { width: 16, height: 16 },
};
export function gemSprite(tier: GemTier): string {
  return `assets/sprites/gems/${tier}.png`;
}

/** "Pickups | `assets/sprites/pickups/chest.png`, `bread.png`, `draft.png` | ... | `24 x 24`". */
export const PICKUP_SIZE: CanvasSize = { width: 24, height: 24 };
export function pickupSprite(kind: PickupKind): string {
  return `assets/sprites/pickups/${kind}.png`;
}

/** "Ground tile | `assets/sprites/ground.png` | ... | `64 x 64`". */
export const GROUND_TILE = "assets/sprites/ground.png";
export const GROUND_TILE_SIZE: CanvasSize = { width: 64, height: 64 };

/** One weapon's effect: its files, its frame count, and its canvas. */
export interface EffectSprite {
  weapon: WeaponId;
  /** The files, one per frame; a still effect has one. */
  files: readonly string[];
  frames: number;
  canvas: CanvasSize;
  /** The seconds each frame is shown, for a sheet; `null` for a still. */
  frameTime: number | null;
  /** Whether a sheet plays once over its flash rather than wrapping. */
  playsOnce: boolean;
}

const still = (weapon: WeaponId, w: number, h: number): EffectSprite => ({
  weapon,
  files: [`assets/sprites/effects/${weapon}.png`],
  frames: 1,
  canvas: { width: w, height: h },
  frameTime: null,
  playsOnce: false,
});

const sheet = (
  weapon: WeaponId,
  frames: number,
  side: number,
  frameTime: number,
  playsOnce: boolean,
): EffectSprite => ({
  weapon,
  files: Array.from(
    { length: frames },
    (_, i) => `assets/sprites/effects/${weapon}/${i}.png`,
  ),
  frames,
  canvas: { width: side, height: side },
  frameTime,
  playsOnce,
});

/** "Seconds each frame of a walk cycle or a spin is shown | `WALK_FRAME_TIME` | `0.1`". */
export const WALK_FRAME_TIME = 0.1;

/** "Seconds a death puff lasts, all four frames together | `PUFF_TIME` | `0.4`". */
export const PUFF_TIME = 0.4;

/**
 * "The weapon effects" table, and the evolved rows "of the same form, frame
 * count, and canvas as its base's". A strike's frame is `SPARK_FLASH / 4`, a
 * burst's `FLARE_FLASH / 6`, and a sconce spins at `WALK_FRAME_TIME`.
 */
export const EFFECT_SPRITES: Readonly<Record<WeaponId, EffectSprite>> = {
  taper: still("taper", 120, 40),
  ember: still("ember", 16, 16),
  pin: still("pin", 12, 12),
  lantern: still("lantern", 28, 28),
  halo: still("halo", 160, 160),
  "oil-splash": still("oil-splash", 100, 100),
  spark: sheet("spark", 4, 80, SPARK_FLASH / 4, true),
  shard: still("shard", 16, 16),
  sconce: sheet("sconce", 4, 24, WALK_FRAME_TIME, false),
  flare: sheet("flare", 6, 128, FLARE_FLASH / 6, true),
  pyre: still("pyre", 120, 40),
  beacon: still("beacon", 16, 16),
  hail: still("hail", 12, 12),
  chandelier: still("chandelier", 28, 28),
  corona: still("corona", 160, 160),
  blaze: still("blaze", 100, 100),
};

/** "Each is one `24 x 24` sprite at `assets/icons/<id>.png`". */
export const ICON_SIZE: CanvasSize = { width: 24, height: 24 };

/** The twenty-seven icon ids: the sixteen weapons, the ten passives, and lamp oil. */
export const ICON_IDS: readonly OfferId[] = OFFER_IDS;

export function iconFile(id: OfferId): string {
  return `assets/icons/${id}.png`;
}

/* -------------------------------------------------------------------------- */
/* Tolerances                                                                 */
/* -------------------------------------------------------------------------- */
//
// Every figure above is exact in the specification. What follows is the
// allowance a check gives a build for the arithmetic the specification leaves
// to it, each stated with its reason, and none of them wide enough to admit a
// figure the specification distinguishes.

/**
 * A product of two figures the specification fixes exactly — a damage times a
 * multiplier, a radius times `areaMul`, a heading's unit vector.
 *
 * `6 × 1.1` is `6.6000000000000005` in binary floating point, and a build is
 * free to multiply in whichever order it likes, so a few ulps either way is the
 * build's arithmetic rather than its rules. The finest figure the specification
 * separates here is `0.1` (a Wick level's tenth), nine orders above this.
 */
export const FLOAT_TOL = 1e-9;

/**
 * A position integrated over ticks: `MOVE_STEP` (`3`) per tick is exact, but a
 * speed times `TICK_DT` (`1/60`, inexact in binary) accumulated across up to
 * `600` ticks drifts by a few `1e-13` per tick. `1e-6` covers a whole run's
 * drift with room to spare and is four orders below the finest position the
 * specification distinguishes, the tenth of a unit between `23.9` and `24`.
 */
export const POSITION_TOL = 1e-6;

/**
 * A timer read back after counting down by `TICK_DT` per tick.
 *
 * specs/world.md holds a timer at exactly `0` once a count-down would leave it
 * below `TICK_DT / 2`, so a due timer reads `0` and no tolerance is needed
 * there. A timer still counting carries the drift of up to `3600` subtractions
 * of `1/60` (Flare's `60` s), of order `1e-12`; `1e-6` is far above that and far
 * below the half-tick (`1/120`) the rule itself turns on.
 */
export const TIMER_TOL = 1e-6;

/**
 * The accumulator, or `simTime`, read back after frames of delta time joined
 * it and whole ticks left it.
 *
 * specs/instrumentation.md fixes the arithmetic's own resolution: "A tick is
 * consumed while the accumulator is at least `TICK_DT − TICK_EPSILON`, with
 * `TICK_EPSILON` (`1e-9`) seconds, and a remainder whose magnitude is below
 * `TICK_EPSILON` is `0`". So the specification itself distinguishes a
 * remainder from `0` only at that scale, and a build that sums a frame's delta
 * and subtracts `TICK_DT` in a different order differs by a few `1e-18`. The
 * same figure, so a reading is held to exactly the resolution the rule gives
 * it, and a remainder the rule calls `0` is read as `0`.
 */
export const ACCUMULATOR_TOL = TICK_EPSILON;

/**
 * An angle, in degrees, recovered from a position on a circle through `atan2`:
 * a lantern after `30` ticks of `180` degrees per second. The trigonometry is
 * exact to `1e-12`; `1e-6` degrees is well inside the `7.5` degrees between
 * two shards of a spread.
 */
export const ANGLE_TOL = 1e-6;

/**
 * The stage position a drawn sprite is read at, in logical units. At the
 * harness's default fit one logical unit is one device pixel, and a build is
 * free to round a fractional world position to the pixel grid before it blits,
 * so a sprite's drawn center is within one unit of the position the state
 * reports; the smallest sprite the specification places is `8` units across.
 */
export const BLIT_TOL = 1;

/**
 * Two canvas colours that are meant to be the same colour — the letterbox
 * against the stage's background — read back within this Euclidean RGB
 * distance: a fill drawn twice through an 8-bit canvas rounds each channel by
 * at most one, and two units on the 0-441 scale is that rounding on every
 * channel at once.
 */
export const SAME_COLOR_TOL = 2;

/**
 * The ground read under a movement of the lamplighter (specs/world.md — "The
 * camera and the view": "The ground is drawn as a pattern fixed in world space
 * and repeating on both axes, so that the lamplighter's motion reads against
 * it"). Both are the harness's own allowances, not the specification's figures.
 *
 * `GROUND_SHIFT_MATCH_MIN`: the share of a region's pixels that, after the
 * lamplighter has moved, match the pixels that stood the movement's distance
 * further along before it. A ground fixed in world space matches everywhere the
 * region holds ground alone; a tenth is left for whatever a build lays over the
 * ground in screen space — a HUD element, a vignette, a lamp's glow — since the
 * specification fixes no layout for those.
 *
 * `GROUND_CHANGE_MIN`: the share of the region's pixels that differ between the
 * two pictures at the SAME stage point, which is what "motion reads against it"
 * asks for at all. A ground that is one flat colour changes nothing under any
 * movement and reads as no motion; one pixel in two hundred is the least a
 * pattern can put in a region for a movement to read against.
 */
export const GROUND_SHIFT_MATCH_MIN = 0.9;
export const GROUND_CHANGE_MIN = 0.005;

/**
 * The seeded drop roll (specs/world.md — "The drop roll"), read over a fixed
 * number of common kills.
 *
 * `4000` kills at `BREAD_CHANCE` (`0.02`) expect `80` breads; the binomial
 * tails below `40` and above `125` each fall under one in a hundred thousand.
 * A draft is rolled only after a failed bread draw, so `4000` kills expect
 * `4000 × 0.98 × 0.005 = 19.6` drafts, and the tails below `3` and above `45`
 * fall under the same bound. A conformant build fails these by chance less
 * than once in fifty thousand runs, and a build that never rolls, or rolls at
 * the wrong rate by a factor of two, fails them every time.
 */
export const DROP_ROLL_KILLS = 4000;
export const BREAD_COUNT_RANGE = { min: 40, max: 125 } as const;
export const DRAFT_COUNT_RANGE = { min: 3, max: 45 } as const;

/**
 * The kills the check that a kill drops at most ONE of the two pickups reads,
 * which is a larger sample than the counting checks above need.
 *
 * The rule is "Only when it did not, a second draw drops a draft"
 * (specs/world.md — "The drop roll"), and the design that breaks it most simply
 * makes the second draw unconditionally. Its only visible mark is the kill on
 * which BOTH draws land, which the two stated chances put at
 * `BREAD_CHANCE × DRAFT_CHANCE` (`0.02 × 0.005`, `1e-4`) per kill. Over
 * `DROP_ROLL_KILLS` that design leaves `0.4` shared centers expected and so
 * escapes about two times in three; over `60000` it leaves `6` expected and
 * escapes about one time in four hundred. The figure is derived from the two
 * chances the specification states and the number of shared centers the check
 * means to expect, never from a build.
 */
export const DROP_PAIR_KILLS = 60_000;

/* -------------------------------------------------------------------------- */
/* The snapshot's fields (specs/instrumentation.md — "Snapshot shape")         */
/* -------------------------------------------------------------------------- */
//
// "The shape is fixed, and every field is present whatever the screen." Each
// list below is one block of the documented shape, field for field, so a check
// on the shape reads the names from here rather than spelling them.

/** The top-level fields of `snapshot()`. */
export const SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "menuIndex",
  "almanacTab",
  "almanacScroll",
  "autoStep",
  ...SWITCH_NAMES,
  "run",
  "muted",
  "accumulator",
  "simTime",
  "rngState",
] as const;

/** The fields of `snapshot().run`. */
export const RUN_FIELDS = [
  "tick",
  "time",
  "level",
  "xp",
  "xpToNext",
  "kills",
  "player",
  "hurtFlash",
  "maxHp",
  "armor",
  "moveSpeed",
  "pickupRadius",
  "weapons",
  "passives",
  "enemies",
  "projectiles",
  "zones",
  "gems",
  "pickups",
  "offers",
  "pool",
  "nextOffers",
  "pendingLevelUps",
  "chestResult",
  "spawnTimer",
  "spawnWindow",
  "firedEvents",
  "aliveCommons",
  "nextId",
] as const;

/** "`player: { x, y, facing: "left" | "right", hp }`". */
export const PLAYER_FIELDS = ["x", "y", "facing", "hp"] as const;

/** "`weapons: [{ id, level, cooldown }]`". */
export const WEAPON_SLOT_FIELDS = ["id", "level", "cooldown"] as const;

/** "`passives: [{ id, level }]`". */
export const PASSIVE_SLOT_FIELDS = ["id", "level"] as const;

/** "`enemies: [{ id, type, x, y, hp, maxHp, heading: { x, y }, age, contactCooldown }]`". */
export const ENEMY_FIELDS = [
  "id",
  "type",
  "x",
  "y",
  "hp",
  "maxHp",
  "heading",
  "age",
  "contactCooldown",
] as const;

/** "`projectiles: [{ id, weapon, x, y, vx, vy, ax, ay, radius, damage, ttl, pierce, hits }]`". */
export const PROJECTILE_FIELDS = [
  "id",
  "weapon",
  "x",
  "y",
  "vx",
  "vy",
  "ax",
  "ay",
  "radius",
  "damage",
  "ttl",
  "pierce",
  "hits",
] as const;

/** "`zones: [{ id, weapon, kind, x, y, radius, width?, height?, damage, ttl, hits }]`", less the two a slash alone carries. */
export const ZONE_FIELDS = [
  "id",
  "weapon",
  "kind",
  "x",
  "y",
  "radius",
  "damage",
  "ttl",
  "hits",
] as const;

/** "`gems: [{ id, tier, x, y, attracted }]`". */
export const GEM_FIELDS = ["id", "tier", "x", "y", "attracted"] as const;

/** "`pickups: [{ id, kind, x, y }]`". */
export const PICKUP_FIELDS = ["id", "kind", "x", "y"] as const;

/** "`hits: [{ enemy, cooldown }]`". */
export const HIT_ENTRY_FIELDS = ["enemy", "cooldown"] as const;
