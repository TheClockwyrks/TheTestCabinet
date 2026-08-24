// Carom (Gyre) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so it can only know the
// surface every variant has. Gyre's specification adds two things to that
// surface — the `setObstacleClock` operation and the `obstacles` array on a
// snapshot — and this module is where the checks below reach them.
//
// It reaches them through a locally declared interface rather than widening the
// shared `CaromDebugApi`, which keeps a gyre check readable and keeps the shared
// harness variant-agnostic. The narrowing is safe by construction: these checks
// only ever run against a gyre build, whose specification requires exactly these.

import { assertEqual, assertLength } from "../assert";
import { OBSTACLE_CENTERS, OBSTACLE_SWAY_PERIOD } from "../constants";
import { failSurface, type Harness } from "../harness";

/** One obstacle's live pose, as `snapshot().obstacles` reports it. */
export interface ObstaclePose {
  cx: number;
  cy: number;
  /** Rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
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
 * Because `setObstacleClock` is one of the operations that poses the game, it
 * also sets `driver.paddles` — and while that is set the obstacle clock is held
 * still rather than advancing with the frame (specs/instrumentation.md). So the
 * pose read back is the pose at exactly `t`, not at `t` plus however long the
 * read took.
 */
export async function poseObstacles(
  h: Harness,
  t: number,
): Promise<ObstaclePose[]> {
  await setObstacleClock(h, t);
  await h.advance(1);
  return readObstacles(h);
}

/** Harnesses whose surface has already been checked for the gyre operation. */
const probed = new WeakSet<Harness>();

/**
 * Pose the obstacle clock, failing by name when the build never installed the
 * operation this variant's specification requires.
 *
 * A named, actionable failure beats `window.__carom.setObstacleClock is not a
 * function` three frames later. A build with no surface at all is reported with
 * the shared harness's fuller message instead, because "gyre is missing one
 * operation" would be a misleading way to say "there is nothing here".
 *
 * The check runs ONCE per harness. A surface cannot gain or lose an operation
 * while a scenario is being driven, and a sweep poses the clock a hundred times
 * over — so re-probing would be a crossing into the page per pose to re-confirm
 * something that was settled on the first.
 */
export async function setObstacleClock(h: Harness, t: number): Promise<void> {
  if (!probed.has(h)) {
    if (h.surfaceFault !== null) failSurface(h.surfaceFault);
    const { ops } = await h.probe(["setObstacleClock"]);
    assertEqual(
      ops.setObstacleClock,
      "function",
      "gyre requires setObstacleClock on the window.__carom surface the build " +
        "installs (specs/instrumentation.md)",
    );
    probed.add(h);
  }
  await (
    h.debug as unknown as { setObstacleClock(seconds: number): Promise<void> }
  ).setObstacleClock(t);
}

/** Both obstacles' live poses, checked for shape before a check reads them. */
export async function readObstacles(h: Harness): Promise<ObstaclePose[]> {
  const snapshot = await h.snapshot();
  const obstacles = snapshot.obstacles;
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
