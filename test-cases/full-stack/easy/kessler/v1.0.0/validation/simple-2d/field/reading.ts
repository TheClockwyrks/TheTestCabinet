// field/reading — the polar readings and aimed spawns the field suites share.
//
// Every figure a suite asserts is computed here from the ball the snapshot
// reports and the polar mapping specs/overview.md fixes; nothing is read from
// the build beyond the snapshot itself. The axes are the ones the angular
// conventions of specs/field.md name: "At a ball's center, `n` is the outward
// unit radial and `t` is the unit tangential, `n` rotated by `+90` degrees."

import { STAGE_CX, STAGE_CY } from "../constants";
import { angularOffset, spawnBallPolar, type Harness } from "../harness";
import type { KesslerSnapshot } from "../surface";

const RAD = Math.PI / 180;

/** The position and velocity fields of one snapshot ball — all a reading needs. */
export interface BallLike {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** One ball, resolved onto specs/field.md's polar axes at its own center. */
export interface BallReading {
  /** Center radius from the stage center. */
  r: number;
  /** Center angle, normalized into [0, 360). */
  thetaDeg: number;
  /** Radial velocity component, outward positive: v . n. */
  vr: number;
  /** Tangential velocity component, positive toward +theta: v . t. */
  vt: number;
  /** The velocity's magnitude. */
  speed: number;
  /** Signed angle from the OUTWARD radial to the velocity, in (-180, 180]. */
  offOutwardDeg: number;
  /** Signed angle from the INWARD radial to the velocity, in (-180, 180]. */
  offInwardDeg: number;
}

/** Resolve one snapshot ball onto the polar axes at its own center. */
export function readBall(ball: BallLike): BallReading {
  const dx = ball.x - STAGE_CX;
  const dy = ball.y - STAGE_CY;
  const r = Math.hypot(dx, dy);
  const nx = dx / r;
  const ny = dy / r;
  const vr = ball.vx * nx + ball.vy * ny;
  const vt = -ball.vx * ny + ball.vy * nx;
  return {
    r,
    thetaDeg: (((Math.atan2(dy, dx) / RAD) % 360) + 360) % 360,
    vr,
    vt,
    speed: Math.hypot(ball.vx, ball.vy),
    offOutwardDeg: Math.atan2(vt, vr) / RAD,
    offInwardDeg: Math.atan2(-vt, -vr) / RAD,
  };
}

/** The signed wrap-aware angular offset from `fromDeg` to `toDeg`. */
export function offsetDeg(fromDeg: number, toDeg: number): number {
  return angularOffset(fromDeg, toDeg);
}

/** The balls the snapshot reports in flight — every one not parked. */
export function unparked(snapshot: KesslerSnapshot) {
  return snapshot.balls.filter((ball) => !ball.parked);
}

/**
 * Spawn one unparked ball at radius `r` and stage angle `thetaDeg`, moving at
 * `speed` headed `offDeg` degrees from the OUTWARD radial at its center
 * (positive toward +theta; 180 is straight inward).
 */
export function spawnAimed(
  h: Harness,
  r: number,
  thetaDeg: number,
  speed: number,
  offDeg = 0,
): void {
  spawnBallPolar(
    h,
    r,
    thetaDeg,
    speed * Math.cos(offDeg * RAD),
    speed * Math.sin(offDeg * RAD),
  );
}
