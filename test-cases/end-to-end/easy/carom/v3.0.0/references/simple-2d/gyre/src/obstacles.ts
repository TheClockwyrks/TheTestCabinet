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
//
// WHICH obstacles stand on the field is state (specs/state.md), so every function
// here poses one obstacle by INDEX and the caller decides which indices exist:
// `clearWorld` leaves none, `spawnObstacle(index)` puts one back.

import {
  OBSTACLE_CENTERS,
  OBSTACLE_SPIN_RATE,
  OBSTACLE_SWAY_AMP,
  OBSTACLE_SWAY_PERIOD,
} from "./constants";
import type { ObstacleState } from "./game";

/**
 * The signed sway offset shared by both obstacles at clock `t`, in logical units.
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

/** Whether `index` names one of the field's obstacles. */
export function isObstacleIndex(index: number): boolean {
  return (
    Number.isInteger(index) && index >= 0 && index < OBSTACLE_CENTERS.length
  );
}

/** Obstacle `index`'s pose at clock `t`, under its own index. */
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
 * Both obstacles' poses for clock `t`, in the order of OBSTACLE_CENTERS: the
 * full field, as the title screen and a fresh match stand it up.
 */
export function poseObstacles(t: number): readonly ObstacleState[] {
  return OBSTACLE_CENTERS.map((_, i) => obstaclePose(i, t));
}

/**
 * The obstacles PRESENT, re-posed at clock `t`, in index order.
 *
 * The field's population is preserved and only the poses are recomputed, which is
 * the invariant the game keeps every frame: `obstacleClock` is the sole input to
 * both poses, so what stands on the field is always the pose that clock names
 * (specs/state.md).
 */
export function reposeObstacles(
  obstacles: readonly ObstacleState[],
  t: number,
): readonly ObstacleState[] {
  return obstacles.map((o) => obstaclePose(o.index, t));
}

/**
 * The obstacles with `index` placed at the pose clock `t` gives it, kept in index
 * order.
 *
 * Spawning one that is already present returns it to that pose rather than
 * doubling it (specs/instrumentation.md).
 */
export function withObstacle(
  obstacles: readonly ObstacleState[],
  index: number,
  t: number,
): readonly ObstacleState[] {
  if (!isObstacleIndex(index)) return obstacles;
  const kept = obstacles.filter((o) => o.index !== index);
  return [...kept, obstaclePose(index, t)].sort((a, b) => a.index - b.index);
}
