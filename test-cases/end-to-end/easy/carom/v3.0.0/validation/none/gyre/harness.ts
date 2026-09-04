// Carom (Gyre) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so what it declares is
// what every variant HAS: the two obstacle-clock operations and an obstacle's
// `theta` are optional there, because base and multi stand their obstacles still
// and upright and report neither. Under gyre they are required, and this module
// is where the checks below reach them.
//
// What it adds to the shared surface is the requirement itself. `h.debug` is a
// proxy that answers every name with a function that would forward the call, so
// a missing operation is invisible until the page throws; this module reflects
// the object in the PAGE once per harness and fails by name instead. The
// narrowing is safe by construction: these checks only ever run against a gyre
// build, whose specification requires exactly these.

import { assertEqual, assertTruthy } from "../assert";
import { OBSTACLE_CENTERS, OBSTACLE_SWAY_PERIOD } from "../constants";
import { failSurface, type Harness } from "../harness";

/** One obstacle's live pose, as `snapshot().obstacles` reports it. */
export interface ObstaclePose {
  /** Its index in the order of `OBSTACLE_CENTERS`. */
  index: number;
  cx: number;
  cy: number;
  /** Rotation about the center, in RADIANS. 0 is upright. */
  theta: number;
}

/**
 * Both obstacles, for a check whose subject is the PAIR.
 *
 * The sway is stated in anti-phase and the rotation as the same direction for
 * both, so a check about either one is about the two together and spawns both.
 * A check about one FACE — the oriented bounce — names the single obstacle it
 * fires at instead.
 */
export const BOTH_OBSTACLES: readonly number[] = OBSTACLE_CENTERS.map(
  (_center, index) => index,
);

/** The obstacle clock time where the sway is at its peak: a quarter period. */
export const PEAK_SWAY_T = OBSTACLE_SWAY_PERIOD / 4;

/** The two operations gyre's specification adds to the shared surface. */
const CLOCK_OPS = ["setObstacleClock", "setObstacleClockRunning"] as const;

/** Harnesses whose surface has already been checked for those two. */
const probed = new WeakSet<Harness>();

/**
 * Fail by name unless the build installed both obstacle-clock operations.
 *
 * A named, actionable failure beats `window.__carom.setObstacleClock is not a
 * function` three frames later. A build with no surface at all is reported with
 * the shared harness's fuller message instead, because "gyre is missing an
 * operation" would be a misleading way to say "there is nothing here".
 *
 * Asked ONCE per harness. A surface cannot gain or lose an operation while a
 * scenario is being driven, and a sweep poses the clock a hundred times over, so
 * re-probing would be a crossing into the page per pose to re-confirm what the
 * first one settled.
 */
async function requireClockOps(h: Harness): Promise<void> {
  if (probed.has(h)) return;
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const { ops } = await h.probe(CLOCK_OPS);
  for (const name of CLOCK_OPS) {
    assertEqual(
      ops[name],
      "function",
      `gyre requires ${name} on the window.__carom surface the build installs ` +
        "(specs/instrumentation.md)",
    );
  }
  probed.add(h);
}

/**
 * Whether the obstacle clock advances with the frame.
 *
 * Its own faculty, rather than a side effect of driving something else: a check
 * stops the clock and takes nothing away from the game with it. Stopping it is
 * how a check about a POSE reads the pose at exactly the value it asked for
 * rather than at that value plus however long the read took.
 */
export async function setObstacleClockRunning(
  h: Harness,
  running: boolean,
): Promise<void> {
  await requireClockOps(h);
  await h.debug.setObstacleClockRunning?.(running);
}

/** Set the obstacle clock to `t` seconds, and nothing else. */
export async function setObstacleClock(h: Harness, t: number): Promise<void> {
  await requireClockOps(h);
  await h.debug.setObstacleClock?.(t);
}

/**
 * Hold the obstacle clock at `t` and return every obstacle's resulting pose.
 *
 * One frame is advanced between the pose and the read, deliberately: the clock
 * is the only thing `setObstacleClock` sets, and the POSES are the build's own,
 * recomputed from that clock on its next frame. Reading without advancing would
 * report the previous frame's field and grade nothing.
 *
 * The clock is stopped first, so the pose read back is the pose at exactly `t`
 * and holds there for as long as the check needs it — which is what lets the
 * oriented-bounce shot cross the field at one fixed orientation.
 */
export async function poseObstacles(
  h: Harness,
  t: number,
): Promise<ObstaclePose[]> {
  await setObstacleClockRunning(h, false);
  await setObstacleClock(h, t);
  await h.advance(1);
  return readObstacles(h);
}

/**
 * Every obstacle PRESENT on the field, checked for shape before a check reads
 * one.
 *
 * The count is not asserted here, because the field holds whatever the scenario
 * spawned back onto it: a check about the pair reads two entries and a check
 * about one face reads one. Each entry is reached by its own `index` through
 * {@link obstacleAt}, never by array position.
 */
export async function readObstacles(h: Harness): Promise<ObstaclePose[]> {
  const snapshot = await h.snapshot();
  const obstacles = snapshot.obstacles;
  assertEqual(
    Array.isArray(obstacles),
    true,
    "gyre requires snapshot().obstacles (specs/instrumentation.md)",
  );
  for (const pose of obstacles) {
    assertEqual(
      typeof pose.theta,
      "number",
      "gyre requires each obstacle's theta, its rotation in radians " +
        "(specs/instrumentation.md)",
    );
  }
  return obstacles as ObstaclePose[];
}

/** The pose of the obstacle carrying `index`, failing by name when it is absent. */
export function obstacleAt(
  poses: readonly ObstaclePose[],
  index: number,
): ObstaclePose {
  const pose = poses.find((candidate) => candidate.index === index);
  assertTruthy(
    pose,
    `snapshot().obstacles must report obstacle ${index}, which spawnObstacle(${index}) ` +
      "placed (specs/instrumentation.md)",
  );
  return pose as ObstaclePose;
}

/** The smallest signed difference between two angles, in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
