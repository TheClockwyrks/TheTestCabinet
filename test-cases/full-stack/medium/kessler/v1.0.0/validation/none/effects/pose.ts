// effects/pose — the effects category's shared glue over the engineless
// harness. All sixteen effects validators read one uniform helper surface, so
// the same suite text runs on every engine; this file is the `none` spelling.
// Every figure re-exported here is a spec figure from validation/constants.ts
// under a uniform name — never a reading of the reference build.

import {
  angularOffset,
  BALL_CAP,
  ballSpeed,
  BURN_UP_RADIUS,
  MULTIBALL_OFFSET_DEG,
  NARROW_SPAN,
  NARROW_TICKS,
  ORBITAL_DECAY_MAX_DEG,
  outwardVelocity,
  PADDLE_SPAN_BASE,
  PADDLE_START_ANGLE,
  PIERCE_TICKS,
  POD_CATCH_POINTS,
  POD_CATCH_RADIUS,
  POD_FALL_SPEED,
  polarOf,
  SERVE_RADIUS,
  SHIELD_CONTACT_RADIUS,
  SHIELD_RADIUS,
  TICK_DT,
  WIDEN_SPAN,
  WIDEN_TICKS,
} from "../constants";
import {
  captureReplay,
  captureStill,
  colorDistance,
  isolate,
  openHarness,
  samplePolar,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
  type KesslerSnapshot,
  type Rgb,
  type UntilResult,
} from "../harness";

export type { Harness, KesslerSnapshot, Rgb };
export { colorDistance };

/** The three timed kinds, and the five pod kinds, as specs/pods.md names them. */
export type TimedKind = "widen" | "narrow" | "pierce";
export type Kind = TimedKind | "multiball" | "shield";

// ---- Spec figures under the uniform names the shared suites read ------------

export const SPAN_BASE = PADDLE_SPAN_BASE; // 48
export const SPAN_WIDEN = WIDEN_SPAN; // 72
export const SPAN_NARROW = NARROW_SPAN; // 30
export const WIDEN_DURATION = WIDEN_TICKS; // 600
export const NARROW_DURATION = NARROW_TICKS; // 600
export const PIERCE_DURATION = PIERCE_TICKS; // 360
export const CATCH_RADIUS = POD_CATCH_RADIUS; // 196
export const LAUNCH_RADIUS = SERVE_RADIUS; // 194
export const SHIELD_DRAW_RADIUS = SHIELD_RADIUS; // 92
export const SHIELD_CROSS_RADIUS = SHIELD_CONTACT_RADIUS; // 100
export const BURN_RADIUS = BURN_UP_RADIUS; // 78
export const CAP = BALL_CAP; // 6
export const MULTI_OFFSET = MULTIBALL_OFFSET_DEG; // 20
export const CATCH_POINTS = POD_CATCH_POINTS; // 25
export const DECAY_MAX = ORBITAL_DECAY_MAX_DEG; // 6
export const DT = TICK_DT; // 1 / 60
export const FALL_PER_TICK = POD_FALL_SPEED * TICK_DT; // 2
export const START_ANGLE = PADDLE_START_ANGLE; // 90

/** The ball speed of wave `w` (specs/deflector-and-ball.md). */
export const speedAtWave = ballSpeed;

/** Wrap-aware signed angular offset from `fromDeg` to `toDeg`, in [-180, 180). */
export const offset = angularOffset;

/** The polar reading of a snapshot body's position. */
export function polar(body: { x: number; y: number }): {
  r: number;
  theta: number;
} {
  return polarOf(body.x, body.y);
}

/**
 * The speed of a velocity, and its signed heading in degrees off the outward
 * radial at stage angle `atThetaDeg` (positive toward `+theta`), measured with
 * the engine's own polar mapping.
 */
export function velocityAt(
  v: { vx: number; vy: number },
  atThetaDeg: number,
): { speed: number; offDeg: number } {
  const n = outwardVelocity(1, atThetaDeg, 0);
  const t = outwardVelocity(1, atThetaDeg, 90);
  const vr = v.vx * n.vx + v.vy * n.vy;
  const vt = v.vx * t.vx + v.vy * t.vy;
  return {
    speed: Math.hypot(v.vx, v.vy),
    offDeg: (Math.atan2(vt, vr) * 180) / Math.PI,
  };
}

// ---- The uniform drive ------------------------------------------------------

export async function open(): Promise<Harness> {
  return openHarness();
}

export async function close(h: Harness): Promise<void> {
  await h.dispose();
}

/** The isolated posed world: playing, emptied, both driver switches off. */
export async function world(
  h: Harness,
  seed?: number,
): Promise<KesslerSnapshot> {
  return isolate(h, seed);
}

export async function snap(h: Harness): Promise<KesslerSnapshot> {
  return h.snapshot();
}

/** Run `n` whole ticks and read what they left. */
export async function ticks(h: Harness, n = 1): Promise<KesslerSnapshot> {
  return h.tick(n);
}

/** Sweep one tick at a time until `pred` holds, or `maxTicks` are spent. */
export async function sweep(
  h: Harness,
  pred: (s: KesslerSnapshot) => boolean,
  maxTicks: number,
): Promise<UntilResult> {
  return h.until(pred, { maxTicks });
}

export async function setEffect(
  h: Harness,
  kind: TimedKind,
  t: number,
): Promise<void> {
  await h.debug.setEffectTicks(kind, t);
}

export async function setShieldOn(h: Harness, on: boolean): Promise<void> {
  await h.debug.setShield(on);
}

export async function park(h: Harness): Promise<void> {
  await h.debug.parkBall();
}

/**
 * Drop one pod of `kind` straight onto the deflector: spawned one unit above
 * the catch radius at the deflector's own center angle, then ONE tick, whose
 * 2-unit inward fall crosses radius 196 within the span — the crossing-event
 * catch of specs/pods.md, staged with a clear margin around the boundary.
 * Returns the catch tick's snapshot; a build that failed to catch still holds
 * the pod there for the caller's assertion to read.
 */
export async function dropPod(
  h: Harness,
  kind: Kind,
): Promise<KesslerSnapshot> {
  const before = await h.snapshot();
  await spawnPodPolar(h, kind, CATCH_RADIUS + 1, before.paddle.angleDeg);
  return h.tick(1);
}

/**
 * Spawn one unparked ball at radius `r`, stage angle `thetaDeg`, at `speed`,
 * headed `offDeg` degrees off the outward radial (180 is straight inward).
 */
export async function spawnBallAt(
  h: Harness,
  r: number,
  thetaDeg: number,
  speed: number,
  offDeg = 0,
): Promise<void> {
  await spawnBallPolar(h, r, thetaDeg, speed, offDeg);
}

/** The rendered pixel at radius `r`, stage angle `thetaDeg`. */
export async function pixelAt(
  h: Harness,
  r: number,
  thetaDeg: number,
): Promise<Rgb> {
  return samplePolar(h, r, thetaDeg);
}

/** Record a replay of the drive `act` runs, to the media output `outputId`. */
export const record = captureReplay;

/** Capture the current canvas as the image output `outputId`. */
export async function still(h: Harness, outputId: string): Promise<void> {
  await captureStill(h, outputId);
}
