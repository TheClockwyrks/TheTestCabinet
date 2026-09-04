// Kessler — the debug and automation surface, as types. CASE-PROVIDED.
//
// This file is the ONLY description of the surface this project holds, and it is
// declared from `specs/instrumentation.md` rather than imported from anything a
// build wrote. That is the whole point of it: a check that reached into the
// build's own module for the shape of the thing it is grading would grade the
// build against itself, and would pass a build whose surface disagreed with the
// specification as long as it disagreed consistently.
//
// TWO SHAPES OF THE SAME SURFACE. {@link KesslerDebugApi} is the surface as the
// specification words it and as the build installs it on `window.__kessler`:
// plain, synchronous operations over plain numbers, strings, and booleans.
// {@link DrivenSurface} is that same surface as a suite reaches it — every
// operation crossing into the page, so every one returning a promise. The
// second is derived from the first, so the two can never drift: adding an
// operation here adds it to both.

import type { PodKind, Screen } from "./constants";

/** The `window` property `specs/instrumentation.md` fixes the surface on. */
export const HANDLE = "__kessler";

/**
 * Every operation the surface carries. All are required of every build: the
 * two clock operations exist under this engine alone (nothing outside an
 * engineless build owns its loop, so `specs/instrumentation.md` puts the clock
 * on the surface), and the rest are the poses and reads the same file
 * enumerates.
 */
export const REQUIRED_OPS = [
  "setAutoStep",
  "step",
  "reset",
  "snapshot",
  "menuItemRect",
  "setScreen",
  "setScore",
  "setLives",
  "setMenuIndex",
  "setInterstitialTicks",
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
 * The hit region `menuItemRect` reports, in the stage's logical units, with
 * `(x, y)` the region's top-left corner.
 */
export interface MenuItemRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One live ball, as the snapshot lists it: spawn order, oldest first. */
export interface BallSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  parked: boolean;
  piercing: boolean;
}

/** One live target, by its slot and the hit points it has left. */
export interface TargetSnapshot {
  slot: number;
  hp: number;
}

/** One ring: entry 0 of `rings` is ring 1, the innermost. */
export interface RingSnapshot {
  /** Normalized into `[0, 360)`. */
  angleDeg: number;
  speedDegPerSec: number;
  /** The live targets by `slot`; a slot with no entry holds no target. */
  targets: TargetSnapshot[];
}

/** One falling pod, in spawn order, oldest first. */
export interface PodSnapshot {
  kind: string;
  x: number;
  y: number;
}

/** The effect timers, in whole ticks; `0` is not in force. */
export interface EffectsSnapshot {
  widenTicks: number;
  narrowTicks: number;
  pierceTicks: number;
  shieldActive: boolean;
}

/**
 * The plain object `snapshot()` returns, field for field as
 * `specs/instrumentation.md` states it. The shape is fixed and every field is
 * present on every screen; every field is read straight off the game's state.
 */
export interface KesslerSnapshot {
  screen: Screen;
  /** Ticks resolved since the last reset; frozen screens still count them. */
  ticks: number;
  wave: number;
  score: number;
  lives: number;
  /** The seed the last `reset` laid the pod generator with. */
  seed: number;
  /** Ticks left of the interstitial; counts down on `waveclear` alone. */
  interstitialTicks: number;
  /** Whether the frame loop advances the simulation from the wall clock. */
  autoStep: boolean;
  /** The two driver switches, each on by default and restored by `reset`. */
  waveAdvance: boolean;
  podSpawn: boolean;
  paddle: { angleDeg: number; spanDeg: number };
  balls: BallSnapshot[];
  /** Always three entries, ring 1 first. */
  rings: RingSnapshot[];
  pods: PodSnapshot[];
  effects: EffectsSnapshot;
  /** The highlighted item, `0` on a screen with no menu. */
  menu: { index: number };
}

/**
 * The surface as `specs/instrumentation.md` words it, and as the build installs
 * it on `window.__kessler` as soon as the game has initialized.
 *
 * Each pose sets ONE thing and leaves the rest of the game as it stands, no
 * pose decides an outcome, and no pose sounds a cue: every bounce, hit,
 * destruction, catch, burn-up, life loss, and clearing comes from the ticks run
 * after the pose. A caller that wants several things arranged makes several
 * calls, which is why every compound sequence in this project lives in
 * `harness.ts` rather than here. An argument outside the domain its operation
 * states fails loudly rather than guessing, except where an operation states
 * that it normalizes (`setPaddleAngle`, `setRingAngle`) or ignores the call
 * (`launchBall` with no parked ball, `spawnBall`/`parkBall` at the cap).
 */
export interface KesslerDebugApi {
  /** Take the game off real time (`false`), or give it back (`true`). */
  setAutoStep(auto: boolean): void;
  /** Run `ticks` whole ticks (>= 1, default 1), each followed by a render. */
  step(ticks?: number): void;

  /** Restore the boot state; `seed` seeds the pod generator. */
  reset(seed?: number): void;
  /** A pure read of the state. It changes nothing. */
  snapshot(): KesslerSnapshot;
  /**
   * Where the build drew menu entry `index` on the current screen, or `null`
   * off a menu and for an `index` outside the menu's entries. It changes
   * nothing.
   */
  menuItemRect(index: number): MenuItemRect | null;

  /** Set `screen` to `name`, and change nothing else. */
  setScreen(name: Screen): void;

  setScore(n: number): void;
  setLives(n: number): void;
  /** Set the highlighted menu entry; off a menu, changes nothing. */
  setMenuIndex(n: number): void;
  /** Set the interstitial timer, in whole ticks. */
  setInterstitialTicks(ticks: number): void;
  /** Set the wave counter and put the wave-`n` figures in force. */
  setWave(n: number): void;

  /** Set the deflector's center angle, normalized into `[0, 360)`. */
  setPaddleAngle(deg: number): void;

  /** Exactly as `Space` on a parked ball; with none, changes nothing. */
  launchBall(): void;
  /** Remove every ball, parked included. Nothing burns up, no life is lost. */
  clearBalls(): void;
  /** Add one unparked ball; piercing iff `pierceTicks > 0`. No-op at the cap. */
  spawnBall(x: number, y: number, vx: number, vy: number): void;
  /** Park one ball at the serve position. No-op with one parked, or at cap. */
  parkBall(): void;

  /** Remove every target. Not a destruction and not a clearing. */
  clearTargets(): void;
  /** Place a target with `hp` in slot `slot` of ring `ring` (1 to 3). */
  spawnTarget(ring: number, slot: number, hp: number): void;
  /** Set ring `ring`'s angle, normalized into `[0, 360)`; speed untouched. */
  setRingAngle(ring: number, deg: number): void;
  /** Set ring `ring`'s orbital speed; holds until `setWave` or a transition. */
  setRingSpeed(ring: number, degPerSec: number): void;

  /** Remove every falling pod. Nothing is caught and nothing burns. */
  clearPods(): void;
  /** Add one pod of `kind` at `(x, y)`; the generator is not consumed. */
  spawnPod(kind: PodKind, x: number, y: number): void;

  /** Set a timed effect's timer; `> 0` puts it in force, `0` ends it. */
  setEffectTicks(kind: "widen" | "narrow" | "pierce", ticks: number): void;
  /** Raise or remove the shield. Neither scores. */
  setShield(active: boolean): void;

  /** The two driver switches; each on by default and restored by `reset`. */
  setWaveAdvance(on: boolean): void;
  setPodSpawn(on: boolean): void;
}

/**
 * The same surface as a suite drives it: every operation crossing into the
 * page, so every one awaited.
 */
export type DrivenSurface = {
  [K in keyof KesslerDebugApi]-?: KesslerDebugApi[K] extends (
    ...args: infer A
  ) => infer R
    ? (...args: A) => Promise<R>
    : never;
};
