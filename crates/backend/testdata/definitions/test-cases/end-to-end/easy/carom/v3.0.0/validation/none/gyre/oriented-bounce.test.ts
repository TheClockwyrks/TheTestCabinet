// gyre/oriented-bounce — the ball reflects off an obstacle's face at that
// face's current orientation.
//
// specs/playfield.md fixes the oriented collision: the ball is taken into the
// obstacle's local frame, the contact normal is found against the local
// rectangle, rotated back by `theta`, and the velocity is reflected about it,
// `v' = v - 2 (v . n) n`, with the speed unchanged. The same level shot at
// obstacle A's center is fired twice:
//
//   * upright (clock 0): the struck face's normal is `(-1, 0)`, so the shot
//     comes straight back, level;
//   * tilted a quarter turn (clock `TILT_T`, `theta = 45deg`): the normal is
//     `(-cos theta, -sin theta)`, and the level shot reflects to the direction
//     that formula gives, which at 45 degrees is straight along `-y`.
//
// Each outgoing direction is read against the reflection the formula gives for
// the theta the build reports, within three degrees: rounding room on a
// velocity computed from a pose, plus the small shift the sub-step that
// resolves the contact leaves in where the normal is taken. A build that
// reflects against the upright box whatever it draws passes the first and fails
// the second.
//
// THE FIELD HOLDS ONE BALL AND OBSTACLE A. A bank shot is about the one body it
// strikes, and the other obstacle sways across the field at every clock value,
// so there is no geometry that would keep it clear of a shot fired at two
// different orientations — it comes off the field instead. The clock is stopped
// at each posed value, so the face the ball meets holds the orientation the
// reading is taken against for the whole crossing.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLessThanOrEqual } from "../assert";
import { OBSTACLE_SPIN_RATE, SERVE_SPEED } from "../constants";
import {
  ball0,
  captureReplay,
  createHarness,
  isolateBall,
  placeBall,
  startPlaying,
  type Harness,
} from "../harness";
import { obstacleAt, poseObstacles, type ObstaclePose } from "./harness";

/** The obstacle the shot is fired at: A, the first of the two. */
const OBSTACLE = 0;

/** The clock at which the obstacles have turned a quarter turn. */
const TILT_T = Math.PI / 4 / OBSTACLE_SPIN_RATE;

const ANGLE_TOLERANCE = (3 * Math.PI) / 180;

/** How far short of the obstacle's center the level shot starts. */
const RUN_UP = 220;

/** Frames of the departing flight recorded after the bounce, for the replay. */
const DEPARTURE_TICKS = 60; // 0.5 s

/** The direction a level shot along `+x` reflects to off the face whose local normal is `-x`, turned by `theta`. */
function reflectedLevel(theta: number): { vx: number; vy: number } {
  const nx = -Math.cos(theta);
  const ny = -Math.sin(theta);
  const dot = 1 * nx;
  return { vx: 1 - 2 * dot * nx, vy: 0 - 2 * dot * ny };
}

/** The unsigned angle between two directions, in radians. */
function angleBetween(
  a: { vx: number; vy: number },
  b: { vx: number; vy: number },
): number {
  const cos =
    (a.vx * b.vx + a.vy * b.vy) /
    (Math.hypot(a.vx, a.vy) * Math.hypot(b.vx, b.vy));
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

async function shootLevelAt(
  h: Harness,
  obstacle: ObstaclePose,
): Promise<{ hit: boolean; vx: number; vy: number; speed: number }> {
  await placeBall(h, {
    x: obstacle.cx - RUN_UP,
    y: obstacle.cy,
    vx: SERVE_SPEED,
  });
  // The contact has resolved once the velocity is no longer the posed one.
  const r = await h.until(
    (s) => ball0(s).vx < SERVE_SPEED - 1 || Math.abs(ball0(s).vy) > 1,
    { maxFrames: 120, poll: 1 },
  );
  const ball = ball0(r.snapshot);
  return { hit: r.hit, vx: ball.vx, vy: ball.vy, speed: ball.speed };
}

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reflects about the face's normal at its current orientation", async () => {
  await startPlaying(harness);
  await isolateBall(harness, 0, [OBSTACLE]);

  // 1. Upright. A vertical face returns a level shot level.
  const upright = obstacleAt(await poseObstacles(harness, 0), OBSTACLE);
  const straight = await shootLevelAt(harness, upright);
  assertEqual(straight.hit, true, "the upright shot reaches the obstacle");
  assertLessThanOrEqual(
    angleBetween(straight, reflectedLevel(upright.theta)),
    ANGLE_TOLERANCE,
    "an upright face returns the shot level",
  );
  assertCloseTo(straight.speed, SERVE_SPEED, 3);

  // 2. The same shot against the face turned a quarter turn.
  const tilted = obstacleAt(await poseObstacles(harness, TILT_T), OBSTACLE);
  const deflected = await captureReplay(harness, "oriented", async () => {
    const shot = await shootLevelAt(harness, tilted);
    await harness.advance(DEPARTURE_TICKS);
    return shot;
  });
  assertEqual(deflected.hit, true, "the tilted shot reaches the obstacle");
  assertLessThanOrEqual(
    angleBetween(deflected, reflectedLevel(tilted.theta)),
    ANGLE_TOLERANCE,
    "a tilted face reflects the shot about its own normal",
  );
  assertCloseTo(deflected.speed, SERVE_SPEED, 3);
});
