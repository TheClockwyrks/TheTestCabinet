// Kessler — the debug and automation surface, as types. CASE-PROVIDED.
//
// "Every scenario driven from code reaches the game through it" —
// specs/instrumentation.md. This file is that specification as types, and it is
// the ONLY description of the surface this project holds: nothing here imports
// the build's own module, so a check grades the build against the spec rather
// than against itself. The build declares and exports its own `KesslerDebugApi`
// from `src/game.ts`; the harness reaches the OBJECT through `engine.debug`
// alone (the spec: "it is reached that way alone: nothing is installed on the
// page") and holds it to the shape declared here.
//
// HOW THE SURFACE IS DRIVEN UNDER THIS ENGINE. The engine holds the state by
// value and hands it out read-only, so every operation is pure and written in
// the shape of `update`: a POSE takes the current state as
// `DeepReadonly<KesslerState>` and returns the next `KesslerState`
// (`setScore(state, 500)`), and a READING takes the state the same way and
// returns what it read (`snapshot(state)`). A caller drives a pose through
// `engine.apply` and a reading against `engine.state`; `harness.ts` wraps both
// so a check writes `h.debug.setScore(500)` and `h.debug.snapshot()`.
//
// There is NO clock operation and NO key operation here, by the spec's own
// words: "The clock, the keyboard, and the overlay belong to the Simple 2D
// engine ... and the surface carries no operation for any of them." A check
// steps the game with `engine.advance` under a `ConstantClock(1000 / 60)` (one
// frame is one tick) and dispatches keyboard-shaped events at the harness's
// event target.

import type { DeepReadonly } from "ts-essentials";

/** The seed `reset` restores when the caller names none (`DEFAULT_SEED`). */
export const DEFAULT_SEED = 1;

/** The six screens, as specs/screens.md names them. The game opens on `title`. */
export type Screen =
  "title" | "howto" | "playing" | "waveclear" | "paused" | "gameover";

/** The five salvage pod kinds, as specs/pods.md names them. */
export type PodKind = "widen" | "multiball" | "shield" | "pierce" | "narrow";

/** The three timed effects `setEffectTicks` poses. */
export type EffectKind = "widen" | "narrow" | "pierce";

/**
 * Every operation the surface carries, in the order
 * `specs/instrumentation.md` states them, so a build's surface can be read
 * against the file that specifies it without hunting.
 */
export const REQUIRED_OPS = [
  "reset",
  "snapshot",
  "setScreen",
  "setScore",
  "setLives",
  "setWave",
  "setPaddleAngle",
  "launchBall",
  "clearBalls",
  "spawnBall",
  "parkBall",
  "clearTargets",
  "spawnTarget",
  "setRingAngle",
  "setRingSpeed",
  "clearPods",
  "spawnPod",
  "setEffectTicks",
  "setShield",
  "setWaveAdvance",
  "setPodSpawn",
] as const;

/** The name of one operation the surface carries. */
export type OperationName = (typeof REQUIRED_OPS)[number];

/**
 * The operations that READ the state rather than replace it.
 *
 * The driver over the surface needs to know which members to call with the
 * current state and hand back, and which to run through `engine.apply`; the
 * surface's shape alone cannot say at runtime, so the specification names them.
 */
export const READINGS = ["snapshot"] as const;

/** `reset`'s options: the seed the pod generator is laid with. */
export interface ResetOptions {
  seed?: number;
}

/** One live ball, parked included, as the snapshot reports it. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  parked: boolean;
  piercing: boolean;
}

/** One live target, by the slot it fills and the hit points it has left. */
export interface TargetSnapshot {
  slot: number;
  hp: number;
}

/** One ring: entry 0 of `rings` is ring 1, the innermost. */
export interface RingSnapshot {
  angleDeg: number;
  speedDegPerSec: number;
  targets: TargetSnapshot[];
}

/** One falling pod, in spawn order. */
export interface PodSnapshot {
  kind: string;
  x: number;
  y: number;
}

/**
 * The plain object `snapshot(state)` returns, field for field as
 * `specs/instrumentation.md` fixes it under "Snapshot shape".
 *
 * The shape is fixed and every field is present on every screen. `balls` and
 * `pods` run in spawn order, oldest first; `rings` always holds three entries,
 * ring 1 first; `paddle.angleDeg` and every ring's `angleDeg` are normalized
 * into `[0, 360)`; the three effect timers count down in whole ticks.
 */
export interface KesslerSnapshot {
  screen: Screen;
  /** Ticks resolved since the last reset; frozen screens still count them. */
  ticks: number;
  wave: number;
  score: number;
  lives: number;
  /** The two driver switches. */
  waveAdvance: boolean;
  podSpawn: boolean;
  paddle: { angleDeg: number; spanDeg: number };
  balls: BallSnapshot[];
  rings: RingSnapshot[];
  pods: PodSnapshot[];
  effects: {
    /** Whole ticks remaining; `0` is not in force. */
    widenTicks: number;
    narrowTicks: number;
    pierceTicks: number;
    shieldActive: boolean;
  };
  /** The highlighted item, `0` on a screen with no menu. */
  menu: { index: number };
}

/**
 * The surface a build's `initialize` returns beside its state as
 * `[state, debug]`, over the build's own state type `S`.
 *
 * Each pose sets ONE thing and leaves the rest of the game as it stands; "no
 * pose decides an outcome: every bounce, hit, destruction, catch, burn-up,
 * life loss, and clearing comes from the ticks run after the pose". A caller
 * that wants several things arranged makes several calls, which is why every
 * compound sequence in this project lives in `harness.ts` rather than here.
 *
 * Positions and velocities are in the stage's logical units and units per
 * second, angles in degrees under the polar mapping specs/field.md fixes, and
 * durations in whole ticks. An argument outside an operation's stated domain
 * fails loudly, except where the operation states that it normalizes
 * (`setPaddleAngle`, `setRingAngle`) or ignores the call (`launchBall`,
 * `spawnBall` at the cap, `parkBall` beside a parked ball).
 */
export interface KesslerDebugApi<S = unknown> {
  /** Restores the boot state; `options.seed` seeds the pod generator. */
  reset(state: DeepReadonly<S>, options?: ResetOptions): S;
  /** A pure reading of `state`. Poses nothing. */
  snapshot(state: DeepReadonly<S>): KesslerSnapshot;

  /** Enters `name` exactly as the real transition into it does. */
  setScreen(state: DeepReadonly<S>, name: Screen): S;
  /** Sets the score to `n`, a whole number of at least 0. */
  setScore(state: DeepReadonly<S>, n: number): S;
  /** Sets the lives to `n`, a whole number of at least 0. */
  setLives(state: DeepReadonly<S>, n: number): S;
  /** Sets the wave to `n` >= 1 and puts the wave-`n` figures in force. */
  setWave(state: DeepReadonly<S>, n: number): S;

  /** Sets the deflector's center angle, normalized into [0, 360). */
  setPaddleAngle(state: DeepReadonly<S>, deg: number): S;
  /** Acts exactly as `Space` does on a parked ball; no parked ball, no-op. */
  launchBall(state: DeepReadonly<S>): S;
  /** Removes every ball, parked included. No burn-up, cue, or particle. */
  clearBalls(state: DeepReadonly<S>): S;
  /** Adds one unparked ball; a no-op at the 6-ball cap. */
  spawnBall(
    state: DeepReadonly<S>,
    x: number,
    y: number,
    vx: number,
    vy: number,
  ): S;
  /** Parks one ball on the deflector; a no-op beside a parked ball or at the cap. */
  parkBall(state: DeepReadonly<S>): S;

  /** Removes every target. Not a destruction and not a clearing. */
  clearTargets(state: DeepReadonly<S>): S;
  /** Places a target with `hp` >= 1 in slot `slot` of ring `ring` (1 to 3). */
  spawnTarget(
    state: DeepReadonly<S>,
    ring: number,
    slot: number,
    hp: number,
  ): S;
  /** Sets ring `ring`'s angle, normalized into [0, 360). Speed untouched. */
  setRingAngle(state: DeepReadonly<S>, ring: number, deg: number): S;
  /** Sets ring `ring`'s orbit speed, signed; holds until the next wave figure. */
  setRingSpeed(state: DeepReadonly<S>, ring: number, degPerSec: number): S;

  /** Removes every falling pod. Nothing caught, nothing burned. */
  clearPods(state: DeepReadonly<S>): S;
  /** Adds one pod of `kind` at `(x, y)`; the generator is not consumed. */
  spawnPod(state: DeepReadonly<S>, kind: PodKind, x: number, y: number): S;

  /** Sets a timed effect's timer; > 0 puts it in force, 0 ends it. */
  setEffectTicks(state: DeepReadonly<S>, kind: EffectKind, ticks: number): S;
  /** Raises or removes the shield ring. Neither scores. */
  setShield(state: DeepReadonly<S>, active: boolean): S;

  /** The two driver switches; each on by default, both restored by reset. */
  setWaveAdvance(state: DeepReadonly<S>, on: boolean): S;
  setPodSpawn(state: DeepReadonly<S>, on: boolean): S;
}
