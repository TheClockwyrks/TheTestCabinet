// Wick — the debug and automation surface, as types. CASE-PROVIDED.
//
// This file is the ONLY description of the surface this project holds, and it
// is declared from `specs/instrumentation.md` rather than imported from
// anything a build wrote. A check that reached into the build's own module for
// the shape of the thing it is grading would grade the build against itself,
// and would pass a build whose surface disagreed with the specification as
// long as it disagreed consistently. The build declares its own `WickDebugApi`
// and `WickSnapshot` in `src/game.ts`; nothing here imports them, and the
// harness reaches the object itself through `engine.debug` alone.
//
// WHERE THE SURFACE LIVES. There is no page handle: the game instance's
// `initialize` returns the finished surface, the engine holds it, and it is
// reached through `engine.debug` alone. So under this engine the "handle" is
// `engine.debug`, and the harness reads it off the engine it constructed.
//
// HOW THE SURFACE IS DRIVEN. Directly. Every operation is a method that takes
// only the parameters its own heading names: a POSE arranges the running game
// through the same systems play uses and returns nothing
// (`setPlayerPosition(300, -120)`), and a READING takes no parameters and
// returns plain data built at the call (`snapshot()`). The harness's `h.debug`
// IS this object rather than a driver over it.
//
// There is NO clock operation and NO input operation here, and that is
// deliberate: the engine owns the frame loop, the keyboard, and the pointer,
// so a check steps the game with `engine.advance` under a scripted clock, one
// frame one tick by default, and dispatches keyboard-, pointer- and
// wheel-shaped events at the surface's own listener. `menuRects` and
// `tabRects` are readings rather than drives: they say WHERE the pointer rules
// of `specs/controls.md` act, and the check aims its own gesture there.

import type {
  EnemyId,
  GemTier,
  OfferId,
  PassiveId,
  PickupKind,
  WeaponId,
} from "./constants";

export type { EnemyId, GemTier, OfferId, PassiveId, PickupKind, WeaponId };

/** Every screen the state machine moves between. The game opens on `title`. */
export type Screen =
  | "title"
  | "howto"
  | "almanac"
  | "playing"
  | "levelup"
  | "chest"
  | "paused"
  | "fallen"
  | "dawn";

/** The nine screens, in the order `specs/ui.md` tabulates them. */
export const SCREENS: readonly Screen[] = [
  "title",
  "howto",
  "almanac",
  "playing",
  "levelup",
  "chest",
  "paused",
  "fallen",
  "dawn",
];

/** The screens a run is live on: the ones most poses apply to. */
export const RUN_SCREENS: readonly Screen[] = ["playing", "paused"];

export type Facing = "left" | "right";

/** The six kinds of zone. */
export type ZoneKind =
  | "puddle"
  | "lantern"
  | "aura"
  | "slash"
  | "strike"
  | "burst";

/** What the open chest overlay reports. */
export type ChestResult =
  | { kind: "evolve"; weapon: WeaponId }
  | { kind: "level"; item: WeaponId | PassiveId; level: number }
  | { kind: "heal" };

/** The weapons `spawnProjectile` takes. */
export type ProjectileWeapon =
  | "ember"
  | "pin"
  | "shard"
  | "sconce"
  | "beacon"
  | "hail";

/** The weapons `spawnPuddle` takes. */
export type PuddleWeapon = "oil-splash" | "blaze";

/** The nine driver switches, by the snapshot field each reports under. */
export const SWITCH_NAMES = [
  "spawning",
  "events",
  "despawning",
  "enemyMotion",
  "enemyContact",
  "weaponFire",
  "effectMotion",
  "drops",
  "progression",
] as const;
export type SwitchName = (typeof SWITCH_NAMES)[number];

/**
 * Every operation the surface carries, in the order
 * `specs/instrumentation.md` states them, so a build's surface can be read
 * against the file that specifies it without hunting.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "menuRects",
  "tabRects",
  "setScreen",
  "choose",
  "setSpawning",
  "setEvents",
  "setDespawning",
  "setEnemyMotion",
  "setEnemyContact",
  "setWeaponFire",
  "setEffectMotion",
  "setDrops",
  "setProgression",
  "setTick",
  "setSpawnTimer",
  "advanceRng",
  "setPlayerPosition",
  "setFacing",
  "setHp",
  "setLevel",
  "setXp",
  "setKills",
  "setPendingLevelUps",
  "setNextOffers",
  "setWeapon",
  "setWeaponCooldown",
  "removeWeapon",
  "setPassive",
  "removePassive",
  "spawnEnemy",
  "setEnemyPosition",
  "setEnemyHp",
  "setEnemyHeading",
  "setEnemyAge",
  "setEnemyContactCooldown",
  "removeEnemy",
  "clearEnemies",
  "spawnProjectile",
  "clearProjectiles",
  "spawnPuddle",
  "clearZones",
  "spawnGem",
  "setGemAttracted",
  "clearGems",
  "spawnPickup",
  "clearPickups",
] as const;

/** The name of one operation the surface carries. */
export type OperationName = (typeof REQUIRED_OPS)[number];

/** `reset`'s options: the seed the generator is laid with. */
export interface ResetOptions {
  readonly seed?: number;
}

/**
 * One rectangle of a menu or a tab bar, in STAGE coordinates: `0` to `STAGE_W`
 * across and `0` to `STAGE_H` down, the coordinates `specs/controls.md` reads
 * the pointer in.
 */
export interface WickRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SnapshotPlayer {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
}

export interface SnapshotWeapon {
  id: WeaponId;
  level: number;
  /** The cooldown timer, in seconds. */
  cooldown: number;
}

export interface SnapshotPassive {
  id: PassiveId;
  level: number;
}

export interface SnapshotEnemy {
  id: number;
  type: EnemyId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  heading: { x: number; y: number };
  /** Seconds since it spawned. */
  age: number;
  /** Seconds until it can hit the lamplighter again. */
  contactCooldown: number;
}

/** One entry of a projectile's or a zone's `hits`. */
export interface SnapshotHit {
  enemy: number;
  cooldown: number;
}

export interface SnapshotProjectile {
  id: number;
  weapon: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  radius: number;
  damage: number;
  ttl: number;
  pierce: number;
  hits: SnapshotHit[];
}

export interface SnapshotZone {
  id: number;
  weapon: WeaponId;
  kind: ZoneKind;
  /** The center of the shape. */
  x: number;
  y: number;
  /** `0` for a slash; a strike's `area`; a burst's Flare `radius`. */
  radius: number;
  /** Present on a slash alone. */
  width?: number;
  height?: number;
  damage: number;
  /** `null` for a zone that never expires: an aura, a Chandelier lantern. */
  ttl: number | null;
  hits: SnapshotHit[];
}

export interface SnapshotGem {
  id: number;
  tier: GemTier;
  x: number;
  y: number;
  attracted: boolean;
}

export interface SnapshotPickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

/**
 * The run in progress or just ended, and the idle run on `title`, `howto`, and
 * `almanac`.
 */
export interface SnapshotRun {
  tick: number;
  /** `tick / TICK_HZ`, seconds. */
  time: number;
  level: number;
  xp: number;
  /** `XP_BASE + XP_STEP × (level − 1)`. */
  xpToNext: number;
  kills: number;
  player: SnapshotPlayer;
  /** Seconds left of the hurt flash. */
  hurtFlash: number;
  maxHp: number;
  armor: number;
  /** Units per second. */
  moveSpeed: number;
  pickupRadius: number;
  weapons: SnapshotWeapon[];
  passives: SnapshotPassive[];
  enemies: SnapshotEnemy[];
  projectiles: SnapshotProjectile[];
  zones: SnapshotZone[];
  gems: SnapshotGem[];
  pickups: SnapshotPickup[];
  /** The open level-up overlay's offers, top to bottom; empty elsewhere. */
  offers: OfferId[];
  /** The candidate pool on `levelup`; empty on every other screen. */
  pool: OfferId[];
  /** What `setNextOffers` queued, or `null`. */
  nextOffers: OfferId[] | null;
  pendingLevelUps: number;
  chestResult: ChestResult | null;
  spawnTimer: number;
  /** `min(19, floor(time / SPAWN_WINDOW))`. */
  spawnWindow: number;
  /** Run-clock seconds of the scripted events that have fired, ascending. */
  firedEvents: number[];
  /** Live commons other than gnats: the count held against the cap. */
  aliveCommons: number;
  nextId: number;
}

/**
 * The plain object `snapshot()` returns, field for field as
 * `specs/instrumentation.md` states it. The shape is fixed and every field
 * is present on every screen.
 */
export interface WickSnapshot {
  version: number;
  screen: Screen;
  /** The highlighted item, `0` on a screen with no menu. */
  menuIndex: number;
  /** The tab the almanac is showing; `0` on every other screen. */
  almanacTab: number;
  /** The almanac list's first visible row; `0` on every other screen. */
  almanacScroll: number;
  spawning: boolean;
  events: boolean;
  despawning: boolean;
  enemyMotion: boolean;
  enemyContact: boolean;
  weaponFire: boolean;
  effectMotion: boolean;
  drops: boolean;
  progression: boolean;
  run: SnapshotRun;
  /** The game's readable copy of the engine's mute bit. */
  muted: boolean;
  /** Frame time waiting for the next tick, in seconds. */
  accumulator: number;
  /** Accumulated simulation time, in seconds, on every screen. */
  simTime: number;
  rngState: number;
}

/**
 * The surface the game instance's `initialize` returns, which the engine
 * hands back from `engine.debug`.
 *
 * Each pose sets ONE thing on the live game through the same systems play
 * uses and leaves the rest as it stands; no pose decides an outcome: every
 * hit, kill, drop, collection, level-up, evolution, and ending comes from the
 * ticks run after the pose. Wick runs in one level for the whole session and
 * every screen is a value of the state's `screen` field, so a pose that
 * changes the screen takes effect at the call. A pose changes the state alone
 * and sounds nothing. An argument outside its stated domain throws; a call on
 * a screen the operation does not apply to leaves the state as it was.
 */
export interface WickDebugApi {
  readonly version: number;
  /**
   * Restores every declared field to its title-screen value: `title` with
   * `menuIndex`, `almanacTab`, and `almanacScroll` all `0`, the idle run, the
   * accumulator and `simTime` at `0`, every
   * driver switch on. `options.seed` seeds the generator, defaulting to
   * `DEFAULT_SEED` (`1`). `muted` stays as it is; any loop stops on the next
   * tick.
   */
  reset(options?: ResetOptions): void;
  /** A pure read of the state; changes nothing. */
  snapshot(): WickSnapshot;
  /**
   * The rectangles of the current screen's vertical menu, in menu order, in
   * stage coordinates. `title`, `levelup`, `paused`, `fallen`, and `dawn`
   * report one per item of the menu they show; `almanac` reports one per
   * VISIBLE entry row, in list order from `almanacScroll` and at most
   * `ALMANAC_ROWS` of them; `howto`, `playing`, and `chest` report an empty
   * list. Each is the area a hover or a click selects that item inside.
   * Changes nothing.
   */
  menuRects(): readonly WickRect[];
  /**
   * The rectangles of the almanac's tab bar on `almanac`, one per tab in
   * `ALMANAC_TABS` order, in stage coordinates; every other screen reports an
   * empty list. Each meets no rectangle `menuRects` reports on that screen.
   * Changes nothing.
   */
  tabRects(): readonly WickRect[];
  /**
   * Sets `screen` to `name`, with `menuIndex`, `almanacTab`, and
   * `almanacScroll` all `0`. Nothing else changes: the run, the loadout,
   * `offers`, `nextOffers`, `chestResult`, `pendingLevelUps`, `rngState`,
   * `simTime`, and the switches all stand as they were, and no cue sounds. A
   * call that leaves `playing` discards the accumulator. Every screen.
   */
  setScreen(name: Screen): void;
  /**
   * On `levelup`, accepts the offer at `index` exactly as `confirm` would; an
   * index outside `offers` leaves the state as it was. Sounds nothing.
   */
  choose(index: number): void;

  setSpawning(on: boolean): void;
  setEvents(on: boolean): void;
  setDespawning(on: boolean): void;
  setEnemyMotion(on: boolean): void;
  setEnemyContact(on: boolean): void;
  setWeaponFire(on: boolean): void;
  setEffectMotion(on: boolean): void;
  setDrops(on: boolean): void;
  setProgression(on: boolean): void;

  /** Sets `tick`, `0` to `DAWN_TIME × TICK_HZ − 1`; nothing else changes. A run screen. */
  setTick(tick: number): void;
  /** Sets `spawnTimer`, at least `0`. A run screen. */
  setSpawnTimer(seconds: number): void;
  /**
   * Takes `draws` draws off the seeded generator and discards them, so
   * `rngState` lands where `draws` random choices would have left it, and
   * `0` leaves it where it stands. `draws` is a whole number of at least
   * `0`. Nothing is chosen with what was drawn. Every screen.
   */
  advanceRng(draws: number): void;

  /** Sets the lamplighter's center; nothing else moves. A run screen. */
  setPlayerPosition(x: number, y: number): void;
  setFacing(facing: Facing): void;
  /** Sets `hp`, at most `maxHp`; no lower bound. A run screen. */
  setHp(hp: number): void;

  /** Sets `level`, at least `1`; `xp` untouched. A run screen. */
  setLevel(level: number): void;
  /** Sets `xp`, at least `0`; no level-up is derived. A run screen. */
  setXp(xp: number): void;
  setKills(kills: number): void;
  setPendingLevelUps(count: number): void;
  /**
   * Sets `nextOffers`, `1` to `OFFER_COUNT` distinct ids, checked against the
   * pool when the next overlay opens. A run screen, and `levelup`.
   */
  setNextOffers(ids: readonly OfferId[]): void;

  /**
   * Puts weapon `id` at `level` in `slot`, `0` to `weapons.length`. A changed
   * id zeroes the slot's timer; a changed level alone keeps it. A run screen.
   */
  setWeapon(slot: number, id: WeaponId, level: number): void;
  setWeaponCooldown(slot: number, seconds: number): void;
  removeWeapon(slot: number): void;
  setPassive(slot: number, id: PassiveId, level: number): void;
  removePassive(slot: number): void;

  /**
   * Spawns one enemy of `type` at `(x, y)` through the real spawn path, with
   * the next id. `playing` and `paused`.
   */
  spawnEnemy(type: EnemyId, x: number, y: number): void;
  setEnemyPosition(id: number, x: number, y: number): void;
  /** Sets `hp`, above `0` and at most `maxHp`. A run screen. */
  setEnemyHp(id: number, hp: number): void;
  /** Sets the heading to the unit vector of `(hx, hy)`; a zero vector is invalid. */
  setEnemyHeading(id: number, hx: number, hy: number): void;
  setEnemyAge(id: number, seconds: number): void;
  setEnemyContactCooldown(id: number, seconds: number): void;
  /** Removes enemy `id`: no drop, no kill, no cue. A run screen. */
  removeEnemy(id: number): void;
  clearEnemies(): void;

  /**
   * Adds one projectile of `weapon` at `(x, y)` with velocity `(vx, vy)` and
   * `pierce`, its figures the ones the weapon would give a projectile fired
   * on this tick. A run screen.
   */
  spawnProjectile(
    weapon: ProjectileWeapon,
    x: number,
    y: number,
    vx: number,
    vy: number,
    pierce: number,
  ): void;
  clearProjectiles(): void;
  /** Adds one puddle of `weapon` at `(x, y)`; it pulses first on the next tick. */
  spawnPuddle(weapon: PuddleWeapon, x: number, y: number): void;
  /** Removes every zone; a held aura or Chandelier set returns on the next tick. */
  clearZones(): void;

  spawnGem(tier: GemTier, x: number, y: number): void;
  setGemAttracted(id: number, attracted: boolean): void;
  /** Removes every gem; no experience is gained. */
  clearGems(): void;
  spawnPickup(kind: PickupKind, x: number, y: number): void;
  /** Removes every pickup; nothing is collected. */
  clearPickups(): void;
}
