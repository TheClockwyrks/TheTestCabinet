// Wick — the debug and automation surface, as types. CASE-PROVIDED.
//
// "Every scenario driven from code reaches the game through it"
// (specs/instrumentation.md). This file is that specification as types, and it
// is the ONLY description of the surface this project holds: nothing here
// imports the build's own module, so a check grades the build against the spec
// rather than against itself. The build declares and exports its own
// `WickDebugApi` and `WickSnapshot` from `src/game.ts`; the harness reaches the
// OBJECT through `engine.debug` alone ("it is reached that way alone: nothing
// is installed on the page") and holds it to the shape declared here.
//
// HOW THE SURFACE IS DRIVEN UNDER THIS ENGINE. The engine holds the state by
// value and hands it out read-only, so every operation is pure and written in
// the shape of `update`: a POSE takes the current state as
// `DeepReadonly<WickState>` and returns the next `WickState`
// (`setHp(state, 40)`), and a READING takes the state the same way and returns
// what it read (`snapshot(state)`). A caller drives a pose through
// `engine.apply` and a reading against `engine.state`; `harness.ts` wraps both
// so a check writes `h.debug.setHp(40)` and `h.snapshot()`.
//
// There is NO clock operation and NO key operation here, by the spec's own
// words: "The clock, the keyboard, and the overlay belong to the Simple 2D
// engine ... and the surface carries no operation for any of them." A check
// steps the game with `engine.advance` under a `ConstantClock(1000 / 60)` (one
// frame on `playing` is one tick) and dispatches keyboard-shaped events at the
// harness's event target.

import type { DeepReadonly } from "ts-essentials";
import type {
  EnemyId,
  GemTier,
  OfferId,
  PassiveId,
  PickupKind,
  ProjectileWeapon,
  PuddleWeapon,
  Screen,
  WeaponId,
} from "./constants";

export type {
  EnemyId,
  GemTier,
  OfferId,
  PassiveId,
  PickupKind,
  ProjectileWeapon,
  PuddleWeapon,
  Screen,
  WeaponId,
};

/** The side the lamplighter faces (specs/state.md). */
export type Facing = "left" | "right";

/** The six kinds of zone (specs/state.md, ZoneState). */
export type ZoneKind =
  "puddle" | "lantern" | "aura" | "slash" | "strike" | "burst";

/** What the open chest overlay reports (specs/state.md, ChestResult). */
export type ChestResult =
  | { kind: "evolve"; weapon: WeaponId }
  | { kind: "level"; item: WeaponId | PassiveId; level: number }
  | { kind: "heal" };

/**
 * Every operation the surface carries, in the order specs/instrumentation.md
 * states them, so a build's surface can be read against the file that
 * specifies it without hunting.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "setScreen",
  "choose",
  "menuRects",
  "tabRects",
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

/**
 * The nine driver switches, each set by its own operation and reported by the
 * snapshot under the same name (specs/instrumentation.md, The driver switches).
 */
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

/** The operation that sets each switch. */
export const SWITCH_OPS: Readonly<Record<SwitchName, OperationName>> = {
  spawning: "setSpawning",
  events: "setEvents",
  despawning: "setDespawning",
  enemyMotion: "setEnemyMotion",
  enemyContact: "setEnemyContact",
  weaponFire: "setWeaponFire",
  effectMotion: "setEffectMotion",
  drops: "setDrops",
  progression: "setProgression",
};

/**
 * The operations that READ the state rather than replace it.
 *
 * The driver over the surface needs to know which members to call with the
 * current state and hand back, and which to run through `engine.apply`; the
 * surface's shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot", "menuRects", "tabRects"] as const;

/**
 * One rectangle a menu reading reports, in stage coordinates, "`0` to `STAGE_W`
 * across and `0` to `STAGE_H` down, which are the coordinates the pointer is
 * read in" (specs/instrumentation.md, Menus).
 */
export interface WickRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** `reset`'s options: the seed the generator is laid with. */
export interface ResetOptions {
  readonly seed?: number;
}

/** The lamplighter, as the snapshot reports it. */
export interface PlayerSnapshot {
  x: number;
  y: number;
  facing: Facing;
  hp: number;
}

/** One held weapon, in slot order. */
export interface WeaponSnapshot {
  id: WeaponId;
  level: number;
  cooldown: number;
}

/** One held passive, in slot order. */
export interface PassiveSnapshot {
  id: PassiveId;
  level: number;
}

/** One live enemy, ascending by id. */
export interface EnemySnapshot {
  id: number;
  type: EnemyId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  heading: { x: number; y: number };
  age: number;
  contactCooldown: number;
}

/** One entry of a projectile's or a zone's `hits`. */
export interface HitSnapshot {
  enemy: number;
  cooldown: number;
}

/** One projectile in flight, ascending by id. */
export interface ProjectileSnapshot {
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
  hits: HitSnapshot[];
}

/** One effect that is not a projectile, ascending by id. */
export interface ZoneSnapshot {
  id: number;
  weapon: WeaponId;
  kind: ZoneKind;
  x: number;
  y: number;
  radius: number;
  /** Present on a slash alone. */
  width?: number;
  height?: number;
  damage: number;
  /** `null` for a zone that never expires: an aura, and a Chandelier lantern. */
  ttl: number | null;
  hits: HitSnapshot[];
}

/** One gem lying on the field or flying to the lamplighter. */
export interface GemSnapshot {
  id: number;
  tier: GemTier;
  x: number;
  y: number;
  attracted: boolean;
}

/** One pickup lying on the field. */
export interface PickupSnapshot {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

/** The run in progress or just ended, as the snapshot reports it. */
export interface RunSnapshot {
  tick: number;
  /** `tick / TICK_HZ`, seconds. */
  time: number;
  level: number;
  xp: number;
  /** `XP_BASE + XP_STEP × (level − 1)`. */
  xpToNext: number;
  kills: number;
  player: PlayerSnapshot;
  /** Seconds left of the hurt flash; `0` while none is running. */
  hurtFlash: number;
  maxHp: number;
  armor: number;
  /** Units per second. */
  moveSpeed: number;
  pickupRadius: number;
  weapons: WeaponSnapshot[];
  passives: PassiveSnapshot[];
  enemies: EnemySnapshot[];
  projectiles: ProjectileSnapshot[];
  zones: ZoneSnapshot[];
  gems: GemSnapshot[];
  pickups: PickupSnapshot[];
  /** The open level-up overlay's offers; empty on every other screen. */
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
  /** Run-clock seconds of the scripted events fired, ascending. */
  firedEvents: number[];
  aliveCommons: number;
  nextId: number;
}

/**
 * The plain object `snapshot(state)` returns, field for field as
 * specs/instrumentation.md fixes it under "Snapshot shape".
 *
 * The shape is fixed and every field is present whatever the screen: `run`
 * reports the idle run on `title`, `howto`, and `almanac` and the run that just
 * ended on `fallen` and `dawn`; `almanacTab` and `almanacScroll` sit beside
 * `menuIndex`, and the nine switches beside `muted`, both outside `run`.
 */
export interface WickSnapshot {
  version: number;
  screen: Screen;
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
  run: RunSnapshot;
  muted: boolean;
  /** Frame time waiting for the next tick, in seconds. */
  accumulator: number;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
  rngState: number;
}

/**
 * The surface a build's `initialize` returns beside its state as
 * `[state, debug]`, over the build's own state type `S`, transcribed from the
 * `WickDebugApi` block of specs/instrumentation.md.
 *
 * Each pose sets ONE thing and leaves the rest of the game as it stands; "No
 * pose decides an outcome: every hit, kill, drop, collection, level-up,
 * evolution, and ending comes from the ticks run after the pose". An argument
 * outside an operation's stated domain throws; a call on a screen the
 * operation does not apply to leaves the state exactly as it was. Every
 * compound sequence in this project lives in `harness.ts` rather than here.
 */
export interface WickDebugApi<S = unknown> {
  /** `WICK_DEBUG_VERSION`, 1. A plain property. */
  readonly version: number;
  /** Restores the title-screen state; `options.seed` seeds the generator. */
  reset(state: DeepReadonly<S>, options?: ResetOptions): S;
  /** A pure reading of `state`. Poses nothing. */
  snapshot(state: DeepReadonly<S>): WickSnapshot;
  /**
   * The current screen's vertical menu, in menu order, and an empty list on
   * `howto`, `playing`, and `chest`. On `almanac` these are the visible entry
   * rows, "in list order from `almanacScroll` and at most `ALMANAC_ROWS` of
   * them". Poses nothing.
   */
  menuRects(state: DeepReadonly<S>): readonly WickRect[];
  /**
   * The almanac's tab bar, one rectangle per tab in `ALMANAC_TABS` order, and
   * an empty list on every other screen. Poses nothing.
   */
  tabRects(state: DeepReadonly<S>): readonly WickRect[];

  /**
   * Sets `screen`, with `menuIndex`, `almanacTab`, and `almanacScroll` all
   * `0`. Nothing else changes: no run is begun, discarded, ended, or grown.
   */
  setScreen(state: DeepReadonly<S>, name: Screen): S;
  /** On `levelup`, accepts the offer at `index`; out of range leaves the state. */
  choose(state: DeepReadonly<S>, index: number): S;

  setSpawning(state: DeepReadonly<S>, on: boolean): S;
  setEvents(state: DeepReadonly<S>, on: boolean): S;
  setDespawning(state: DeepReadonly<S>, on: boolean): S;
  setEnemyMotion(state: DeepReadonly<S>, on: boolean): S;
  setEnemyContact(state: DeepReadonly<S>, on: boolean): S;
  setWeaponFire(state: DeepReadonly<S>, on: boolean): S;
  setEffectMotion(state: DeepReadonly<S>, on: boolean): S;
  setDrops(state: DeepReadonly<S>, on: boolean): S;
  setProgression(state: DeepReadonly<S>, on: boolean): S;

  /** Sets `tick`, 0 to `DAWN_TIME × TICK_HZ − 1`; nothing else changes. */
  setTick(state: DeepReadonly<S>, tick: number): S;
  /** Sets `spawnTimer`, at least 0. */
  setSpawnTimer(state: DeepReadonly<S>, seconds: number): S;

  /** Sets the lamplighter's center; nothing else moves. */
  setPlayerPosition(state: DeepReadonly<S>, x: number, y: number): S;
  setFacing(state: DeepReadonly<S>, facing: Facing): S;
  /** Sets `hp`, at most `maxHp`, no lower bound. */
  setHp(state: DeepReadonly<S>, hp: number): S;

  /** Sets `level`, at least 1; `xp` untouched. */
  setLevel(state: DeepReadonly<S>, level: number): S;
  /** Sets `xp`, at least 0; no level-up is derived from it. */
  setXp(state: DeepReadonly<S>, xp: number): S;
  setKills(state: DeepReadonly<S>, kills: number): S;
  setPendingLevelUps(state: DeepReadonly<S>, count: number): S;
  /** Sets `nextOffers`, 1 to `OFFER_COUNT` distinct ids. */
  setNextOffers(state: DeepReadonly<S>, ids: readonly OfferId[]): S;

  /** Puts weapon `id` at `level` in `slot`, 0 to `weapons.length`. */
  setWeapon(
    state: DeepReadonly<S>,
    slot: number,
    id: WeaponId,
    level: number,
  ): S;
  /** Sets the cooldown timer of the weapon in a held `slot`, at least 0. */
  setWeaponCooldown(state: DeepReadonly<S>, slot: number, seconds: number): S;
  /** Removes the weapon in a held `slot`; the slots after it move up. */
  removeWeapon(state: DeepReadonly<S>, slot: number): S;
  /** Puts passive `id` at `level` in `slot`, 0 to `passives.length`. */
  setPassive(
    state: DeepReadonly<S>,
    slot: number,
    id: PassiveId,
    level: number,
  ): S;
  /** Removes the passive in a held `slot`. */
  removePassive(state: DeepReadonly<S>, slot: number): S;

  /** Spawns one enemy of `type` at `(x, y)` through the real spawn path. */
  spawnEnemy(state: DeepReadonly<S>, type: EnemyId, x: number, y: number): S;
  setEnemyPosition(state: DeepReadonly<S>, id: number, x: number, y: number): S;
  /** Sets an enemy's `hp`, above 0 and at most its `maxHp`. */
  setEnemyHp(state: DeepReadonly<S>, id: number, hp: number): S;
  /** Sets an enemy's heading to the unit vector of `(hx, hy)`; zero is invalid. */
  setEnemyHeading(
    state: DeepReadonly<S>,
    id: number,
    hx: number,
    hy: number,
  ): S;
  setEnemyAge(state: DeepReadonly<S>, id: number, seconds: number): S;
  setEnemyContactCooldown(
    state: DeepReadonly<S>,
    id: number,
    seconds: number,
  ): S;
  /** Removes enemy `id`: nothing drops, nothing counts, no cue. */
  removeEnemy(state: DeepReadonly<S>, id: number): S;
  /** Removes every enemy the same way. */
  clearEnemies(state: DeepReadonly<S>): S;

  /** Adds one projectile of `weapon` at `(x, y)` with velocity `(vx, vy)`. */
  spawnProjectile(
    state: DeepReadonly<S>,
    weapon: ProjectileWeapon,
    x: number,
    y: number,
    vx: number,
    vy: number,
    pierce: number,
  ): S;
  clearProjectiles(state: DeepReadonly<S>): S;
  /** Adds one zone of kind `puddle` for `weapon` at `(x, y)`. */
  spawnPuddle(
    state: DeepReadonly<S>,
    weapon: PuddleWeapon,
    x: number,
    y: number,
  ): S;
  /** Removes every zone, the aura and the lanterns included. */
  clearZones(state: DeepReadonly<S>): S;

  /** Places one unattracted gem of `tier` at `(x, y)`. */
  spawnGem(state: DeepReadonly<S>, tier: GemTier, x: number, y: number): S;
  setGemAttracted(state: DeepReadonly<S>, id: number, attracted: boolean): S;
  /** Removes every gem; no experience is gained. */
  clearGems(state: DeepReadonly<S>): S;
  /** Places one pickup of `kind` at `(x, y)`. */
  spawnPickup(
    state: DeepReadonly<S>,
    kind: PickupKind,
    x: number,
    y: number,
  ): S;
  /** Removes every pickup; nothing is collected. */
  clearPickups(state: DeepReadonly<S>): S;
}
