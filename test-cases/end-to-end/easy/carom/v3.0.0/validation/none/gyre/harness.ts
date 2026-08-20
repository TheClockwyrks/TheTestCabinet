// Carom (Gyre) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so it can only know the
// surface every variant has. Gyre's workspace adds two things to that surface —
// the `setObstacleClock` operation and the `obstacles` array on a snapshot — and
// this module is where the checks below reach them.
//
// It reaches them through a locally declared interface rather than the imported
// `CaromDebugApi`, because the shared harness is typed against whichever
// workspace the tree was seeded from. Narrowing here keeps a gyre check readable
// and keeps the shared harness variant-agnostic. The cast is safe by
// construction: these checks only ever run against a gyre tree, whose
// `src/debug.ts` declares exactly these members.

import { expect } from "vitest";
import { OBSTACLE_CENTERS, OBSTACLE_SWAY_PERIOD } from "../../src/constants";
import type { Harness } from "../harness";

/** One obstacle's live pose, as `snapshot().obstacles` reports it. */
export interface ObstaclePose {
  cx: number;
  cy: number;
  /** Rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
}

/** The operations gyre's `src/debug.ts` adds to the common surface. */
interface GyreDebugOps {
  setObstacleClock(t: number): void;
}

interface GyreSnapshot {
  obstacles?: ObstaclePose[];
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
  const ops = h.debug as unknown as Partial<GyreDebugOps>;
  // A named, actionable failure beats `ops.setObstacleClock is not a function`
  // three frames later: this variant's specification requires the operation.
  expect(
    typeof ops.setObstacleClock,
    "gyre requires window.__carom.setObstacleClock (specs/instrumentation.md)",
  ).toBe("function");
  return ops as GyreDebugOps;
}

/** Both obstacles' live poses, checked for shape before a check reads them. */
export function readObstacles(h: Harness): ObstaclePose[] {
  const snapshot = h.snapshot() as unknown as GyreSnapshot;
  const obstacles = snapshot.obstacles;
  expect(
    Array.isArray(obstacles),
    "gyre requires snapshot().obstacles (specs/instrumentation.md)",
  ).toBe(true);
  expect(obstacles).toHaveLength(OBSTACLE_CENTERS.length);
  return obstacles as ObstaclePose[];
}

/** The smallest signed difference between two angles, in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
