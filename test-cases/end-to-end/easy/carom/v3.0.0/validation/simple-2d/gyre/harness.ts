// Carom (Gyre) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so it can only know the
// surface every variant has. Gyre's workspace adds two things to that surface —
// the `setObstacleClock` operation and the `obstacles` array on a snapshot — and
// this module is where the checks below reach them.
//
// `surface.ts` declares both as optional, because the shared harness serves every
// variant and only this one's specification names them. What this module adds is
// the requirement: a gyre check reaches them through the helpers below, which
// fail with the member named when a build left it out, rather than throwing a
// `TypeError` several frames later.

import { OBSTACLE_CENTERS, OBSTACLE_SWAY_PERIOD } from "../constants";
import { assertEqual, assertLength } from "../assert";
import type { Harness } from "../harness";
import type { ObstacleSnapshot } from "../surface";

/** One obstacle's live pose, as `snapshot().obstacles` reports it. */
export type ObstaclePose = ObstacleSnapshot;

/** The operations gyre's specification adds to the common surface. */
interface GyreDebugOps {
  setObstacleClock(t: number): void;
}

/** The obstacle clock time where the sway is at its peak: a quarter period. */
export const PEAK_SWAY_T = OBSTACLE_SWAY_PERIOD / 4;

/**
 * Pose the obstacle clock at `t` and return both obstacles' resulting poses.
 *
 * One frame is advanced between the pose and the read, deliberately: the clock
 * is the only thing `setObstacleClock` sets, and the POSES are the build's own,
 * recomputed from that clock on its next frame. Reading without advancing would
 * report the previous frame's field and grade nothing.
 *
 * Because `setObstacleClock` is a control operation it also takes the paddles,
 * which is what holds the clock still — so the pose read back is the pose at
 * exactly `t`, not at `t` plus however long the read took.
 */
export async function poseObstacles(
  h: Harness,
  t: number,
): Promise<ObstaclePose[]> {
  gyreOps(h).setObstacleClock(t);
  await h.advance(1);
  return readObstacles(h);
}

/** The operations this variant adds, over a harness for a gyre tree. */
export function gyreOps(h: Harness): GyreDebugOps {
  const ops = h.debug;
  // A named, actionable failure beats `ops.setObstacleClock is not a function`
  // three frames later: this variant's specification requires the operation.
  assertEqual(
    typeof ops.setObstacleClock,
    "function",
    "gyre requires setObstacleClock on the debug surface the build returns " +
      "beside its state (specs/instrumentation.md)",
  );
  return ops as GyreDebugOps;
}

/** Both obstacles' live poses, checked for shape before a check reads them. */
export function readObstacles(h: Harness): ObstaclePose[] {
  const obstacles = h.snapshot().obstacles;
  assertEqual(
    Array.isArray(obstacles),
    true,
    "gyre requires snapshot().obstacles (specs/instrumentation.md)",
  );
  const poses = obstacles as ObstaclePose[];
  assertLength(poses, OBSTACLE_CENTERS.length);
  return poses;
}

/** The smallest signed difference between two angles, in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
