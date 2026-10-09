// Carom (Gyre) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so it can only know the
// surface every variant has. Gyre's specification adds three things to that
// surface — the `setObstacleClock` and `setObstacleClockRunning` operations, and
// the `theta` each entry of `snapshot().obstacles` carries — and this module is
// where the checks below reach them.
//
// `surface.ts` declares all three as optional, because the shared harness serves
// every variant and only this one's specification names them. What this module
// adds is the REQUIREMENT: a gyre check reaches them through the helpers below,
// which fail with the member named when a build left it out, rather than
// throwing a `TypeError` several frames later.
//
// HOLDING THE CLOCK IS AN OPERATION OF ITS OWN. The retired surface froze the
// obstacle clock as a side effect of posing it — and, worse, as a side effect of
// seizing the paddles — which is exactly the compound behaviour the atomic
// surface removed. `setObstacleClock(t)` now sets the clock and nothing else, and
// `setObstacleClockRunning(false)` is the one thing that stops it advancing with
// the frame (specs/instrumentation.md). A check that wants a HELD pose asks for
// both, which is what {@link poseObstacles} does — and a check about the clock
// RUNNING asks for neither, so nothing it does can hold the thing it is watching.

import { OBSTACLE_SWAY_PERIOD } from "../constants";
import { assertEqual, assertTruthy } from "../assert";
import { holdObstacleClock, type Harness } from "../harness";

/**
 * One obstacle's live pose, as gyre's `snapshot().obstacles` reports it.
 *
 * Deliberately NOT `surface.ts`'s `ObstacleSnapshot`, whose `theta` is optional
 * because base and multi stand their obstacles upright and report none. Under
 * gyre the rotation is required, so it is a number here and {@link readObstacles}
 * is where a build that omitted it is caught.
 */
export interface ObstaclePose {
  /** Its index in the order of `OBSTACLE_CENTERS`. */
  index: number;
  cx: number;
  cy: number;
  /** Its rotation about that center, in radians, with 0 upright. */
  theta: number;
}

/** The obstacle clock time where the sway is at its peak: a quarter period. */
export const PEAK_SWAY_T = OBSTACLE_SWAY_PERIOD / 4;

/** What the build owes when it carries neither of gyre's clock operations. */
const CLOCK_REQUIREMENT =
  "gyre requires setObstacleClock and setObstacleClockRunning on the debug " +
  "surface the build's instance returns from initialize " +
  "(specs/instrumentation.md)";

/**
 * Fail, naming the operations, unless the build carries gyre's obstacle clock.
 *
 * A named, actionable failure beats `ops.setObstacleClock is not a function`
 * three frames later: this variant's specification requires both operations, and
 * the shared harness reaches them through `?.` precisely because it also serves
 * the two variants that have neither.
 */
export function requireObstacleClock(h: Harness): void {
  assertEqual(typeof h.debug.setObstacleClock, "function", CLOCK_REQUIREMENT);
  assertEqual(
    typeof h.debug.setObstacleClockRunning,
    "function",
    CLOCK_REQUIREMENT,
  );
}

/**
 * Stop the obstacle clock and hold it at `t` seconds.
 *
 * Two atomic operations: the clock stops advancing with the frame, and then it
 * is set. In that order, so no frame can slip between the set and the stop and
 * carry the poses off the time the check asked for.
 */
export function holdObstacles(h: Harness, t: number): void {
  requireObstacleClock(h);
  holdObstacleClock(h, t);
}

/**
 * Hold the obstacle clock at `t` and return both obstacles' resulting poses.
 *
 * One frame is advanced between the pose and the read, deliberately: the clock
 * is the only thing this sets, and the POSES are the build's own, recomputed
 * from that clock (specs/state.md). Reading without advancing would report the
 * previous frame's field and grade nothing.
 *
 * The clock is stopped rather than merely set, so the pose read back is the pose
 * at exactly `t` and not at `t` plus the frame the read cost.
 */
export async function poseObstacles(
  h: Harness,
  t: number,
): Promise<ObstaclePose[]> {
  holdObstacles(h, t);
  await h.advance(1);
  return readObstacles(h);
}

/**
 * Every obstacle on the field, at its live pose, checked for shape before a
 * check reads it.
 *
 * Whatever is PRESENT, rather than a fixed two: the field a check poses holds
 * only the obstacles its requirement concerns, so a check that wants both says
 * so itself and one that isolated a single obstacle reads back one.
 */
export function readObstacles(h: Harness): ObstaclePose[] {
  const { obstacles } = h.snapshot();
  assertEqual(
    Array.isArray(obstacles),
    true,
    "gyre requires snapshot().obstacles, every obstacle present under its " +
      "own index (specs/instrumentation.md)",
  );
  return obstacles.map((obstacle) => {
    assertEqual(
      typeof obstacle.theta,
      "number",
      `obstacle ${obstacle.index}: gyre requires theta, its rotation in ` +
        `radians (specs/instrumentation.md)`,
    );
    return {
      index: obstacle.index,
      cx: obstacle.cx,
      cy: obstacle.cy,
      theta: obstacle.theta as number,
    };
  });
}

/**
 * The pose of the obstacle at `index`, by the index it reports rather than by
 * where it happens to sit in the array.
 */
export function obstacleAt(
  poses: readonly ObstaclePose[],
  index: number,
): ObstaclePose {
  const found = poses.find((pose) => pose.index === index);
  assertTruthy(
    found,
    `obstacle ${index} must be present on the field, under its own index ` +
      `(specs/instrumentation.md)`,
  );
  return found as ObstaclePose;
}

/** The smallest signed difference between two angles, in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
