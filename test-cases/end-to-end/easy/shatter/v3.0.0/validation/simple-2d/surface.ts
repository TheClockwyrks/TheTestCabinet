// Shatter — the debug surface as the CASE specifies it. CASE-PROVIDED.
//
// specs/instrumentation.md fixes the surface a build's `initialize` returns
// beside its state, as `[state, debug]`, and this module is that specification
// written down as types: the operations, their arguments, the snapshot shape,
// and the version. It is the ONLY description of the surface the validators
// read. The build implements it under whatever module it likes and declares its
// own types for it; nothing here imports them, and the harness reaches the
// object itself through `engine.debug` alone. So a build whose surface departs
// from the specification is held against the specification, not against its own
// idea of what it wrote.
//
// HOW THE SURFACE IS DRIVEN. The engine holds the state by value and hands it
// out read-only, so the surface holds no state of its own and nothing on it
// mutates anything. Every operation is written in the shape of the game's
// `update`: a POSE takes the current state and returns the next one
// (`setShipPosition(state, 640, 560)`), and a READING takes the current state
// and returns what it read (`snapshot(state)`). A caller drives a pose through
// `engine.apply((s) => debug.setShipPosition(s, 640, 560))` — the engine stores
// what the pose returned, and the next frame's `update` receives it — and a
// reading through `debug.snapshot(engine.state)`. `version` is a plain number.
//
// THE SHAPE OF EVERY OPERATION. Each pose SETS ONE FIELD, EMPTIES ONE ROSTER, or
// ADDS ONE ENTITY, and takes scalars. There is no patch operation, nothing that
// arranges several elements at once, and nothing that fabricates an outcome: a
// pose puts the game into a situation and the game's own stepping, gravity,
// collision, scoring and wave rules run from there. Every field a pose can set
// is reported by `snapshot`, so every one of them is verifiable by setting a
// value and reading it back. The sequences a scenario needs — empty the world,
// open a quiet run, shoot the field down — are the HARNESS's, built out of these
// atoms; see `harness.ts`.
//
// The surface is generic over the build's state type, because this module
// imports nothing of the build: `harness.ts` binds it to the `ShatterState` the
// build declared, and the `Driver` there is what gives the checks the imperative
// reading (`h.debug.setShipPosition(640, 560)`, `h.debug.snapshot()`) over the
// pure shape declared here.
//
// THE TWO VARIANTS SHARE ONE SURFACE. `warhead` adds a rock's health and the
// whole torpedo section; every one of those members is declared here as OPTIONAL
// so one harness serves both workspaces, and the `warhead` slices assert the
// member their specification names before a check reads it — see
// {@link WARHEAD_OPS}. Everything in {@link REQUIRED_OPS} is owed by every build
// of this case.

import type { DeepReadonly } from "ts-essentials";

/** The version the surface reports as `version` (`SHATTER_DEBUG_VERSION`). */
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

/** The ship, as a snapshot reports it. */
export interface ShipSnapshot {
  /** The ship's CENTRE, in the logical units of the 1280x720 field. */
  x: number;
  y: number;
  /** Its velocity, in logical units per second. */
  vx: number;
  vy: number;
  /** Its facing, in radians, measured clockwise from the positive x axis. */
  angle: number;
  /** The magnitude of the velocity: `hypot(vx, vy)`. */
  speed: number;
  /** Whether thrust is being applied this tick. */
  thrusting: boolean;
  /** Seconds of respawn grace left, `0` for none. */
  invuln: number;
  /** Whether the ship's lethal contact test runs. */
  collision: boolean;
  /** Whole simulation ticks until the gun may fire again. */
  fireCooldown: number;
}

/** One round in flight, the ship's or the saucer's, as a snapshot reports it. */
export interface BulletSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** The seconds of its lifetime that remain. */
  life: number;
}

/** One rock on the field, as a snapshot reports it. */
export interface RockSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: RockSize;
  /** Its collision radius, fixed by its size. */
  radius: number;
  /** The hits it has left: `warhead` only. */
  health?: number;
}

/** The one saucer slot, as a snapshot reports it when one is up. */
export interface SaucerSnapshot {
  /** Fresh on each arrival; never reused while a live entity holds it. */
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its steering decisions run. */
  mind: boolean;
  /** Its gun runs. */
  gun: boolean;
  /** Its locomotion runs. */
  travel: boolean;
  /** Seconds until its next aimed shot; `SAUCER_FIRE_INTERVAL` on arrival. */
  fireClock: number;
  /** Seconds until it rerolls its weave; `SAUCER_WEAVE_INTERVAL` on arrival. */
  weaveClock: number;
  /** Seconds it has been on the field; `0` on arrival. */
  age: number;
}

/** One torpedo in flight, as a `warhead` snapshot reports it. */
export interface TorpedoSnapshot {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its heading, in radians. */
  heading: number;
  life: number;
  /** Whether its guidance runs. */
  homing: boolean;
}

/**
 * The plain, JSON-serializable view `snapshot()` returns.
 *
 * The `warhead` members are optional here and required of a `warhead` build: a
 * `base` build reports no torpedoes and no rock health, and one shape serves
 * both so the shared checks are the same check under either variant.
 */
export interface ShatterSnapshot {
  version: number;
  screen: Screen;
  /** The highlighted entry of the current screen's menu, counted from 0. */
  menuIndex: number;
  score: number;
  /** Ships left, INCLUDING the one in play, so a fresh game reports 3. */
  lives: number;
  /** The wave being played; `0` before the first. */
  wave: number;
  /** Seconds left on the `WAVE N` banner, `0` when none is showing. */
  waveBanner: number;
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
  /** Every torpedo in flight, in roster order: `warhead` only. */
  torpedoes?: TorpedoSnapshot[];
  /** The stored charge, `0` to `1`: `warhead` only. */
  torpedoCharge?: number;
  /** True exactly when the charge is `1`: `warhead` only. */
  torpedoReady?: boolean;
  /** Accumulated simulation time, in seconds. */
  simTime: number;
}

/**
 * The surface a build returns beside its state from `initialize`, over the
 * build's own state type `S`.
 *
 * Each pose is a transition — the current state in, the next state out — and
 * `snapshot` is a reading of the current state. None of them touches the state
 * it was handed: `DeepReadonly<S>` is the view the engine hands out, and the
 * compiler is what says a pose returns a new value rather than mutating.
 */
export interface ShatterDebugApi<S = unknown> {
  version: number;

  /* ---- The core ---------------------------------------------------------- */

  /** Restores every declared field to its title-screen value. */
  reset(state: DeepReadonly<S>, options?: { seed?: number }): S;
  /** A pure read of the state. It changes nothing. */
  snapshot(state: DeepReadonly<S>): ShatterSnapshot;

  /* ---- The screen and the run -------------------------------------------- */

  setScreen(state: DeepReadonly<S>, screen: Screen): S;
  setMenuIndex(state: DeepReadonly<S>, n: number): S;
  /** Sets the score. It grants no extra ship, whatever boundary it crosses. */
  setScore(state: DeepReadonly<S>, n: number): S;
  setLives(state: DeepReadonly<S>, n: number): S;
  /** Sets the wave number. It spawns no rock and clears none. */
  setWave(state: DeepReadonly<S>, n: number): S;
  /** Seconds left on the `WAVE N` banner; `0` clears it. */
  setWaveBanner(state: DeepReadonly<S>, seconds: number): S;

  /* ---- The world gates --------------------------------------------------- */

  /** Gates the game's own wave loop, and nothing else. */
  setWaveSpawning(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the game's own arrival of a saucer, and nothing else. */
  setSaucerSpawning(state: DeepReadonly<S>, enabled: boolean): S;

  /* ---- The ship ---------------------------------------------------------- */

  setShipPosition(state: DeepReadonly<S>, x: number, y: number): S;
  setShipVelocity(state: DeepReadonly<S>, vx: number, vy: number): S;
  /** Sets the facing. It changes no velocity. */
  setShipAngle(state: DeepReadonly<S>, radians: number): S;
  /** Seconds of respawn grace remaining; `0` clears it. */
  setShipInvuln(state: DeepReadonly<S>, seconds: number): S;
  /** Whole ticks until the gun may fire again. */
  setFireCooldown(state: DeepReadonly<S>, ticks: number): S;
  /** Gates the ship's LETHAL CONTACT TEST alone; the core slide runs on. */
  setShipCollision(state: DeepReadonly<S>, enabled: boolean): S;

  /* ---- The bullets ------------------------------------------------------- */

  /** Appends one of the ship's bullets, with a full `BULLET_LIFE`. */
  addBullet(
    state: DeepReadonly<S>,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): S;
  removeBullet(state: DeepReadonly<S>, id: number): S;
  /** Empties the ship's bullets alone. */
  clearBullets(state: DeepReadonly<S>): S;
  /** Appends one saucer bullet, with a full `SAUCER_BULLET_LIFE`. */
  addEnemyBullet(
    state: DeepReadonly<S>,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): S;
  removeEnemyBullet(state: DeepReadonly<S>, id: number): S;
  /** Empties the saucer's bullets alone. */
  clearEnemyBullets(state: DeepReadonly<S>): S;

  /* ---- The layout the specification leaves to the build ------------------ */

  /**
   * The hit region of the entry at `index` on the menu the current screen shows,
   * in logical units, with `(x, y)` its top-left corner.
   *
   * `null` on `howto` and `playing`, which show no menu, and for an index naming
   * no entry of the menu the current screen shows. A reading, so it changes
   * nothing (`specs/instrumentation.md`).
   */
  menuItemRect(state: DeepReadonly<S>, index: number): Rect | null;

  /* ---- The rocks --------------------------------------------------------- */

  /** Appends one rock of `size`, AT REST, at full health for its size. */
  addRock(state: DeepReadonly<S>, size: RockSize, x: number, y: number): S;
  setRockVelocity(
    state: DeepReadonly<S>,
    id: number,
    vx: number,
    vy: number,
  ): S;
  removeRock(state: DeepReadonly<S>, id: number): S;
  /** Empties the rocks alone. It destroys nothing and scores nothing. */
  clearRocks(state: DeepReadonly<S>): S;
  /** Sets a rock's remaining hits: `warhead` only. */
  setRockHealth?(state: DeepReadonly<S>, id: number, hp: number): S;

  /* ---- The saucer -------------------------------------------------------- */

  /** Brings a saucer on travelling right at `SAUCER_SPEED`, faculties on. */
  addSaucer(state: DeepReadonly<S>, x: number, y: number): S;
  setSaucerVelocity(state: DeepReadonly<S>, vx: number, vy: number): S;
  /** Clears the saucer: both the per-entity removal and the clear. */
  removeSaucer(state: DeepReadonly<S>): S;
  /** Gates the weave reroll and the core avoidance alone. */
  setSaucerMind(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the aimed shot alone. */
  setSaucerGun(state: DeepReadonly<S>, enabled: boolean): S;
  /** Gates the locomotion alone; the mind and the gun run on. */
  setSaucerTravel(state: DeepReadonly<S>, enabled: boolean): S;

  /* ---- The torpedoes: `warhead` only ------------------------------------- */

  /** Sets the stored charge, `0` to `1`. */
  setTorpedoCharge?(state: DeepReadonly<S>, fraction: number): S;
  /** Appends one torpedo at `TORPEDO_SPEED` along `heading`, guidance on. */
  addTorpedo?(state: DeepReadonly<S>, x: number, y: number, heading: number): S;
  /** Sets a torpedo's heading. Its speed is unchanged. */
  setTorpedoHeading?(state: DeepReadonly<S>, id: number, radians: number): S;
  /** Gates one torpedo's GUIDANCE alone; travel, life and impact run on. */
  setTorpedoHoming?(state: DeepReadonly<S>, id: number, enabled: boolean): S;
  removeTorpedo?(state: DeepReadonly<S>, id: number): S;
  /** Empties the torpedoes alone. */
  clearTorpedoes?(state: DeepReadonly<S>): S;
}

/**
 * The operations that READ the state rather than replace it.
 *
 * A driver over the surface needs to know which members to call with the current
 * state and hand the result back, and which to run through `engine.apply`; the
 * surface's shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot", "menuItemRect"] as const;

/**
 * Every operation the surface must carry in EVERY variant.
 *
 * This is the list `instrumentation/surface-present` walks, so it is the
 * specification's own inventory rather than a convenience: an operation missing
 * from here is one no check can require.
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
 * Every operation a `warhead` build owes on top of {@link REQUIRED_OPS}.
 *
 * A `base` build owes none of them, and a `base` run's checklist names no check
 * that reads one — which is why they are optional on the interface above and
 * asserted by the `warhead` slices rather than by the shared ones.
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

/** Every field `snapshot()` reports in every variant, with its documented type. */
export const SNAPSHOT_FIELDS: Readonly<Record<string, string>> = {
  version: "number",
  screen: "string",
  menuIndex: "number",
  score: "number",
  lives: "number",
  wave: "number",
  waveBanner: "number",
  muted: "boolean",
  waveSpawning: "boolean",
  saucerSpawning: "boolean",
  saucerClock: "number",
  saucerDue: "number",
  ship: "object",
  bullets: "object",
  rocks: "object",
  saucer: "object",
  enemyBullets: "object",
  simTime: "number",
};

/** Every field the ship's entry reports, with its documented type. */
export const SHIP_FIELDS: Readonly<Record<string, string>> = {
  x: "number",
  y: "number",
  vx: "number",
  vy: "number",
  angle: "number",
  speed: "number",
  thrusting: "boolean",
  invuln: "number",
  collision: "boolean",
  fireCooldown: "number",
};

/** Every field a bullet's entry reports, with its documented type. */
export const BULLET_FIELDS: Readonly<Record<string, string>> = {
  id: "number",
  x: "number",
  y: "number",
  vx: "number",
  vy: "number",
  life: "number",
};

/** Every field a rock's entry reports in every variant, with its type. */
export const ROCK_FIELDS: Readonly<Record<string, string>> = {
  id: "number",
  x: "number",
  y: "number",
  vx: "number",
  vy: "number",
  size: "string",
  radius: "number",
};

/** Every field the saucer's entry reports, with its documented type. */
export const SAUCER_FIELDS: Readonly<Record<string, string>> = {
  id: "number",
  x: "number",
  y: "number",
  vx: "number",
  vy: "number",
  mind: "boolean",
  gun: "boolean",
  travel: "boolean",
  fireClock: "number",
  weaveClock: "number",
  age: "number",
};

/** Every field a torpedo's entry reports under `warhead`, with its type. */
export const TORPEDO_FIELDS: Readonly<Record<string, string>> = {
  id: "number",
  x: "number",
  y: "number",
  vx: "number",
  vy: "number",
  heading: "number",
  life: "number",
  homing: "boolean",
};
