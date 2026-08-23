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
 * Both obstacles' poses for clock `t`, in the order of OBSTACLE_CENTERS.
 *
 * A fresh array every call: the poses are declared state, and the state a frame
 * leaves behind is a new value, so the frame's obstacles are built beside the rest
 * of it rather than written into slots an earlier frame owned.
 */
export function poseObstacles(t: number): readonly ObstacleState[] {
  return OBSTACLE_CENTERS.map((_, i) => obstaclePose(i, t));
}
