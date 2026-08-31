// Orbits — shared readings and poses for the checks on the rings' orbits.
// CASE-PROVIDED.
//
// specs/rings.md fixes the motion these checks watch: "Each ring's angle
// advances by its orbit speed in step 2 of the tick order, positive speeds
// toward `+theta` and negative speeds toward `-theta`. Ring angles wrap modulo
// `360`." The figures come from the same file's ring table, held in
// `../constants`. Everything here is arithmetic over those figures and over
// the snapshot — no helper asserts, so every verdict is a validator's own.

import { ringSpec } from "../constants";
import {
  angularOffset,
  spawnBallPolar,
  velocityPolar,
  xyToPolar,
  type Harness,
} from "../harness";
import type { KesslerSnapshot, SnapshotBall } from "../surface";

export { ORBITAL_DECAY_DEG as DECAY_MAX_DEG } from "../constants";

/** Ring `ring`'s (1 to 3) reported angle, normalized into `[0, 360)`. */
export function ringAngle(s: KesslerSnapshot, ring: number): number {
  return s.rings[ring - 1].angleDeg;
}

/** Ring `ring`'s (1 to 3) reported orbit speed, signed degrees per second. */
export function ringSpeed(s: KesslerSnapshot, ring: number): number {
  return s.rings[ring - 1].speedDegPerSec;
}

/** The orbit speed the specs/rings.md table fixes for ring `ring` at wave `w`. */
export function ringSpeedAt(ring: number, wave: number): number {
  return ringSpec(ring).orbitSpeedAtWave(wave);
}

/** Ring `ring`'s contact band, the radii its face crossings are decided at. */
export function ringContactBand(ring: number): {
  inner: number;
  outer: number;
} {
  const spec = ringSpec(ring);
  return { inner: spec.innerContactRadius, outer: spec.outerContactRadius };
}

/** The hit points slot 0 of ring `ring` holds, or `0` with the slot empty. */
export function slotZeroHp(s: KesslerSnapshot, ring: number): number {
  return s.rings[ring - 1].targets.find((t) => t.slot === 0)?.hp ?? 0;
}

/**
 * The signed wrap-aware advance from the angle `fromDeg` to the angle `toDeg`,
 * in `[-180, 180)` — positive toward `+theta`, the way specs/field.md reads
 * every angular offset. No reading here spans half a turn: the fastest orbit
 * covers 45 degrees in the one second a check watches.
 */
export function advanceDeg(fromDeg: number, toDeg: number): number {
  return angularOffset(fromDeg, toDeg);
}

/** One snapshot ball's polar position. */
export function ballPolar(ball: SnapshotBall): { r: number; theta: number } {
  const at = xyToPolar(ball.x, ball.y);
  return { r: at.r, theta: at.thetaDeg };
}

/**
 * One snapshot ball's velocity on the local polar axes of specs/field.md:
 * `vr` along `n`, the outward unit radial at the ball's center, and `vt`
 * along `t`, `n` rotated by `+90` degrees — positive `vt` toward `+theta`.
 */
export function ballVelocityPolar(ball: SnapshotBall): {
  vr: number;
  vt: number;
} {
  return velocityPolar(ball.x, ball.y, ball.vx, ball.vy);
}

/**
 * Spawn one ball at radius `r` and angle `thetaDeg` moving purely radially:
 * `radialSpeed` positive outward, negative inward, units per second.
 */
export function spawnBallRadial(
  h: Harness,
  r: number,
  thetaDeg: number,
  radialSpeed: number,
): void {
  spawnBallPolar(h, r, thetaDeg, radialSpeed);
}
