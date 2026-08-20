// Carom (Gyre) — the obstacle poses (specs/playfield.md).
//
// Both obstacles are pure functions of one number: the obstacle clock, in
// seconds. Nothing here integrates and nothing here remembers, which is what
// makes a posed clock reproduce a pose exactly — `setObstacleClock(t)` and a
// match that has been running for `t` seconds face the identical field.
//
// The two sway in ANTI-PHASE and rotate the SAME way, so the layout stays
// point-symmetric about the field center at every instant: whatever obstacle A
// is doing above the center line, B is doing the mirror of below it.

import {
  OBSTACLE_CENTERS,
  OBSTACLE_SPIN_RATE,
  OBSTACLE_SWAY_AMP,
  OBSTACLE_SWAY_PERIOD,
} from "./constants";
import type { ObstacleState } from "./game";

/**
 * The signed sway offset shared by both obstacles at clock `t`, in px.
 *
 * Obstacle A adds it and obstacle B subtracts it, which is the anti-phase the
 * specification asks for.
 */
export function swayOffset(t: number): number {
  return OBSTACLE_SWAY_AMP * Math.sin((2 * Math.PI * t) / OBSTACLE_SWAY_PERIOD);
}

/** The rotation both obstacles carry at clock `t`, in radians. 0 is upright. */
export function spinAngle(t: number): number {
  return OBSTACLE_SPIN_RATE * t;
}

/** Obstacle `index`'s pose at clock `t`. */
export function obstaclePose(index: number, t: number): ObstacleState {
  const base = OBSTACLE_CENTERS[index];
  if (!base) throw new RangeError(`Carom: no obstacle ${index}`);
  // A is displaced by +sway, B by -sway. The x never moves.
  const sign = index === 0 ? 1 : -1;
  return {
    cx: base.x,
    cy: base.y + sign * swayOffset(t),
    theta: spinAngle(t),
  };
}

/**
 * Write both obstacles' poses for clock `t` into `out`, in place.
 *
 * In place because the poses are declared state: the array identity is part of
 * what `initialize` built, and rebuilding it every frame would churn objects the
 * renderer and the collision both hold for the length of a frame.
 */
export function poseObstacles(out: ObstacleState[], t: number): void {
  for (let i = 0; i < OBSTACLE_CENTERS.length; i++) {
    const pose = obstaclePose(i, t);
    const slot = out[i];
    if (slot) {
      slot.cx = pose.cx;
      slot.cy = pose.cy;
      slot.theta = pose.theta;
    } else {
      out[i] = pose;
    }
  }
  out.length = OBSTACLE_CENTERS.length;
}
