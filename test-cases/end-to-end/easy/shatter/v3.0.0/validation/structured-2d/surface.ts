// Shatter — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface the game instance's `initialize`
// returns, and this module is that specification written down as types: the
// operations, their arguments, the snapshot shape, and the version. It is the
// ONLY description of the surface the validators read. The build implements the
// surface under whatever module it likes and declares its own type for it — the
// `D` of its `GameDefinition<D>`; nothing here imports it, and the harness
// reaches the object itself through `engine.debug` alone. So a build whose
// surface departs from the specification is held against the specification, not
// against its own idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. Each operation acts on the running game at the
// moment of the call, through the same systems play uses: a POSE takes only the
// arguments its heading names, returns nothing, and arranges the live world
// (`addRock("large", 320, 620)`, `setShipVelocity(0, -80)`), and a READING takes
// no arguments and returns plain data read off the world at the instant of the
// call (`snapshot()`). A caller therefore drives both directly —
// `engine.debug.addRock(...)`, `engine.debug.snapshot()` — with no wrapper in
// between. `version` is a plain number.
//
// THE TWO VARIANTS SHARE ONE SURFACE. `warhead` adds armor and the torpedo, and
// every member it adds is declared OPTIONAL here so one harness serves both
// workspaces: `setRockHealth`, the six torpedo operations, and the snapshot's
// `rocks[].health`, `torpedoes`, `torpedoCharge` and `torpedoReady`. The shared
// checks never reach for one; the slices under `armor/`, `torpedo/` and
// `detonation/`, and the three `warhead` scripts under `instrumentation/`,
// require the member their specification names before they read it —
// {@link requireOp} is how.
//
// The clock, the keyboard, the audio bus, and the overlay belong to the engine
// under this engine, so the surface carries no operation for any of them:
// `setAutoStep` and `advance` exist under the engineless build alone, and
// demanding either here would fail a perfectly conformant build. There is no
// `setMuted` under any engine — `muted` is the runtime's own bit, reached
// through the `mute` action and reported by the snapshot.

import { fail } from "./assert";

/** The surface's version, reported as `version` (`SHATTER_DEBUG_VERSION`). */
export const SHATTER_DEBUG_VERSION = 1;

/** The seed `reset()` restores when the caller names none. */
export const DEFAULT_SEED = 1;

/** The five screens the game moves between. */
export type Screen = "title" | "howto" | "playing" | "paused" | "gameover";

/** The three rock sizes. */
export type RockSize = "large" | "medium" | "small";

/**
 * A menu entry's hit region, in logical field units, with `(x, y)` its top-left
 * corner (`specs/instrumentation.md`).
 *
 * Where the regions ARE is the build's own layout, which `specs/ui.md` leaves to
 * it, so nothing in this project compares one against a figure: a check reads a
 * region to drive a mouse or a contact at it, and grades what the menu does next.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in the field's logical units. Every position is an entity's CENTRE. */
export interface Point {
  x: number;
  y: number;
}

/** The ship, as the snapshot reports it. */
export interface ShipSnapshot {
  /** The ship's CENTRE. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its facing, in radians, measured clockwise from the positive x axis. */
  angle: number;
  /** The magnitude of the velocity, built at the call. No pose sets it. */
  speed: number;
  /** Thrust is being applied this tick. */
  thrusting: boolean;
  /** Seconds of respawn grace left, `0` for none. */
  invuln: number;
  /** The ship's lethal contact test runs. */
  collision: boolean;
  /** Whole ticks until the gun may fire again. */
  fireCooldown: number;
}

/** One round in flight — the ship's gun, or the saucer's. */
export interface BulletSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The seconds of its lifetime that remain. */
  life: number;
}

/** One rock on the field. */
export interface RockSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  /** The collision radius its size fixes, built at the call. No pose sets it. */
  radius: number;
  /** The hits it has left. `warhead` only. */
  health?: number;
}

/** The saucer, when one is up. */
export interface SaucerSnapshot {
  /**
   * Fresh on each arrival, distinct among every live entity, and not reused
   * while any live entity holds it — so one visit is distinguishable from the
   * next.
   */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its three faculty gates. */
  mind: boolean;
  gun: boolean;
  travel: boolean;
  /** Seconds until its next aimed shot; `SAUCER_FIRE_INTERVAL` on arrival. */
  fireClock: number;
  /** Seconds until it rerolls its weave; `SAUCER_WEAVE_INTERVAL` on arrival. */
  weaveClock: number;
  /** Seconds it has been on the field; `0` on arrival. */
  age: number;
}

/** One torpedo in flight. `warhead` only. */
export interface TorpedoSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its heading, in radians. */
  heading: number;
  life: number;
  /** Its guidance gate. */
  homing: boolean;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * Every field an operation can set is present, so every operation is verifiable
 * by setting a value and reading it back — except `tickClock`, `nextId` and
 * `rngState`, the bookkeeping `reset` restores and `specs/instrumentation.md`
 * deliberately keeps out of the snapshot. Three entries are built at the call
 * rather than read off a field: `ship.speed` and `rocks[].radius` under both
 * variants, and `torpedoReady` under `warhead`.
 */
export interface ShatterSnapshot {
  version: number;
  screen: Screen;
  /** The highlighted entry of the current screen's menu, from `0`. */
  menuIndex: number;
  score: number;
  /** Ships left, INCLUDING the one in play, so a fresh game reports `3`. */
  lives: number;
  /** `0` before the first wave. */
  wave: number;
  /** Seconds left on the `WAVE N` banner, `0` when none is showing. */
  waveBanner: number;
  /** The runtime's own mute bit, refreshed in every update. */
  muted: boolean;
  /** The game's own wave loop runs. */
  waveSpawning: boolean;
  /** The game's own saucer arrival runs. */
  saucerSpawning: boolean;
  /** Seconds the current arrival cadence has run. */
  saucerClock: number;
  /** What `saucerClock` must reach for the next saucer to arrive, in seconds. */
  saucerDue: number;
  ship: ShipSnapshot;
  /** Every one of the ship's bullets in flight, in roster order. */
  bullets: BulletSnapshot[];
  /** Every rock on the field, in roster order. */
  rocks: RockSnapshot[];
  /** The saucer, or `null` when none is up. */
  saucer: SaucerSnapshot | null;
  /** Every saucer bullet in flight, in roster order. */
  enemyBullets: BulletSnapshot[];
  /** Every torpedo in flight, in roster order. `warhead` only. */
  torpedoes?: TorpedoSnapshot[];
  /** The stored charge, `0` to `1`. `warhead` only. */
  torpedoCharge?: number;
  /** True exactly when the charge is `1`, built at the call. `warhead` only. */
  torpedoReady?: boolean;
  /** Accumulated simulation time, in seconds, on every screen. */
  simTime: number;
}

/**
 * The surface the game instance's `initialize` returns, which the engine hands
 * back from `engine.debug`.
 *
 * Each pose acts on the live game at the moment of the call and returns nothing;
 * `snapshot` is a reading of that same running game, built at the call. No frame
 * has to be advanced between a pose and the reading that checks it.
 *
 * Every `x`, `y`, `vx` and `vy` is in the logical units of the fixed
 * `1280 x 720` field, and every position is an entity's CENTRE. Angles are in
 * radians and durations in seconds, with one exception: `setFireCooldown` takes
 * whole simulation TICKS, because specs/weapons.md fixes the gun's gate in ticks.
 */
export interface ShatterDebugApi {
  version: number;

  reset(options?: { seed?: number }): void;
  snapshot(): ShatterSnapshot;
  /**
   * The hit region of the entry at `index` on the menu the current screen shows,
   * in logical units, with `(x, y)` its top-left corner.
   *
   * `null` on `howto` and `playing`, which show no menu, and for an index naming
   * no entry of the menu the current screen shows. A reading, so it changes
   * nothing (`specs/instrumentation.md`).
   */
  menuItemRect(index: number): Rect | null;

  setScreen(screen: Screen): void;
  setMenuIndex(index: number): void;
  setScore(score: number): void;
  setLives(lives: number): void;
  setWave(wave: number): void;
  setWaveBanner(seconds: number): void;

  setWaveSpawning(enabled: boolean): void;
  setSaucerSpawning(enabled: boolean): void;

  setShipPosition(x: number, y: number): void;
  setShipVelocity(vx: number, vy: number): void;
  setShipAngle(radians: number): void;
  setShipInvuln(seconds: number): void;
  setFireCooldown(ticks: number): void;
  setShipCollision(enabled: boolean): void;

  addBullet(x: number, y: number, vx: number, vy: number): void;
  removeBullet(id: number): void;
  clearBullets(): void;
  addEnemyBullet(x: number, y: number, vx: number, vy: number): void;
  removeEnemyBullet(id: number): void;
  clearEnemyBullets(): void;

  addRock(size: RockSize, x: number, y: number): void;
  setRockVelocity(id: number, vx: number, vy: number): void;
  removeRock(id: number): void;
  clearRocks(): void;

  addSaucer(x: number, y: number): void;
  setSaucerVelocity(vx: number, vy: number): void;
  removeSaucer(): void;
  setSaucerMind(enabled: boolean): void;
  setSaucerGun(enabled: boolean): void;
  setSaucerTravel(enabled: boolean): void;

  /** `warhead` only: the rock's remaining hits, `1` to its size's full health. */
  setRockHealth?(id: number, hp: number): void;

  /** `warhead` only. */
  setTorpedoCharge?(fraction: number): void;
  addTorpedo?(x: number, y: number, heading: number): void;
  setTorpedoHeading?(id: number, radians: number): void;
  setTorpedoHoming?(id: number, enabled: boolean): void;
  removeTorpedo?(id: number): void;
  clearTorpedoes?(): void;
}

/**
 * The operations that READ the running game rather than pose it.
 *
 * The surface's shape alone cannot say at runtime which members return a value
 * and which arrange the world, so the specification names them: a check that
 * sweeps the surface (instrumentation/surface-present) calls a reading for its
 * value and a pose for its effect.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/**
 * Every operation the surface must carry under BOTH variants.
 *
 * `setAutoStep` and `advance` belong to the engineless build alone
 * (specs/instrumentation.md): the engine owns the clock here, so they are
 * deliberately absent.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "menuItemRect",

  "setScreen",
  "setMenuIndex",
  "setScore",
  "setLives",
  "setWave",
  "setWaveBanner",

  "setWaveSpawning",
  "setSaucerSpawning",

  "setShipPosition",
  "setShipVelocity",
  "setShipAngle",
  "setShipInvuln",
  "setFireCooldown",
  "setShipCollision",

  "addBullet",
  "removeBullet",
  "clearBullets",
  "addEnemyBullet",
  "removeEnemyBullet",
  "clearEnemyBullets",

  "addRock",
  "setRockVelocity",
  "removeRock",
  "clearRocks",

  "addSaucer",
  "setSaucerVelocity",
  "removeSaucer",
  "setSaucerMind",
  "setSaucerGun",
  "setSaucerTravel",
] as const;

/**
 * The operations a `warhead` build's surface must carry on top of
 * {@link REQUIRED_OPS}. A `base` build carries none of them, and no shared check
 * reaches for one.
 */
export const WARHEAD_OPS = [
  "setRockHealth",
  "setTorpedoCharge",
  "addTorpedo",
  "setTorpedoHeading",
  "setTorpedoHoming",
  "removeTorpedo",
  "clearTorpedoes",
] as const;

/** Every snapshot field the specification's Snapshot shape block names. */
export const REQUIRED_SNAPSHOT_FIELDS = [
  "version",
  "screen",
  "menuIndex",
  "score",
  "lives",
  "wave",
  "waveBanner",
  "muted",
  "waveSpawning",
  "saucerSpawning",
  "saucerClock",
  "saucerDue",
  "ship",
  "bullets",
  "rocks",
  "saucer",
  "enemyBullets",
  "simTime",
] as const;

/** Every field of `snapshot().ship`. */
export const REQUIRED_SHIP_FIELDS = [
  "x",
  "y",
  "vx",
  "vy",
  "angle",
  "speed",
  "thrusting",
  "invuln",
  "collision",
  "fireCooldown",
] as const;

/** The snapshot fields a `warhead` build carries on top of the common ones. */
export const WARHEAD_SNAPSHOT_FIELDS = [
  "torpedoes",
  "torpedoCharge",
  "torpedoReady",
] as const;

/**
 * A `warhead`-only operation, hard-asserted before it is driven.
 *
 * The variant members above are optional on the type so one harness serves both
 * workspaces, which leaves a `warhead` check free to call one that is not there
 * and crash on a `TypeError` — a build that shipped no torpedo would then be
 * reported as a broken suite rather than as a build missing an operation its
 * specification requires. Requiring it first turns that into the verdict the
 * item is for:
 *
 * ```ts
 * requireOp(h.debug, "addTorpedo")(640, 360, FACE_UP);
 * ```
 *
 * The failure names the operation and specs/instrumentation.md, which is where
 * the reviewer looks next.
 */
export function requireOp<K extends keyof ShatterDebugApi>(
  surface: ShatterDebugApi,
  name: K,
): NonNullable<ShatterDebugApi[K]> {
  const member = surface[name];
  if (typeof member !== "function") {
    fail(
      `the debug surface to carry ${String(name)} (specs/instrumentation.md)`,
      member === undefined ? "undefined" : typeof member,
    );
  }
  // Bound to the surface, because a build is free to write its operations as
  // methods that read `this`: taking the function off the object and calling it
  // bare would then fail for a reason that has nothing to do with the check.
  return (member as (...args: never[]) => unknown).bind(surface) as NonNullable<
    ShatterDebugApi[K]
  >;
}
