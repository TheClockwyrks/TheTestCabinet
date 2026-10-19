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

/** Whether `index` names one of the obstacles this field carries. */
export function isObstacleIndex(index: number): boolean {
  return (
    Number.isInteger(index) && index >= 0 && index < OBSTACLE_CENTERS.length
  );
}

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
    index,
    cx: base.x,
    cy: base.y + sign * swayOffset(t),
    theta: spinAngle(t),
  };
}

/**
 * Re-pose every obstacle PRESENT in `field` for clock `t`, in place.
 *
 * In place because the poses are declared state and an absent obstacle must stay
 * absent: the array is the field's contents, and re-posing it is not the same as
 * rebuilding it. Which obstacles are there is `clearWorld` and `spawnObstacle`'s
 * business (specs/instrumentation.md); this only moves the ones that are.
 */
export function poseObstacles(field: ObstacleState[], t: number): void {
  for (const obstacle of field) {
    const pose = obstaclePose(obstacle.index, t);
    obstacle.cx = pose.cx;
    obstacle.cy = pose.cy;
    obstacle.theta = pose.theta;
  }
}

/** Every obstacle, present and posed for clock `t`, in index order. */
export function fullField(t: number): ObstacleState[] {
  return OBSTACLE_CENTERS.map((_, index) => obstaclePose(index, t));
}

/**
 * Place obstacle `index` at clock `t`, replacing it if it is already there.
 *
 * The field stays in the order of `OBSTACLE_CENTERS`, which is the order
 * `snapshot().obstacles` reports and the order the collision resolves in.
 */
export function placeObstacle(
  field: ObstacleState[],
  index: number,
  t: number,
): void {
  const pose = obstaclePose(index, t);
  const at = field.findIndex((obstacle) => obstacle.index === index);
  if (at >= 0) field[at] = pose;
  else {
    field.push(pose);
    field.sort((a, b) => a.index - b.index);
  }
}
