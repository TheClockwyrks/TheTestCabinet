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

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLE_SPIN_RATE, SERVE_SPEED } from "../constants";
import {
  ball0,
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { poseObstacles, type ObstaclePose } from "./harness";

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
  await h.debug.setBall(0, {
    x: obstacle.cx - RUN_UP,
    y: obstacle.cy,
    vx: SERVE_SPEED,
    vy: 0,
    spin: 0,
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

  // 1. Upright. A vertical face returns a level shot level.
  const upright = (await poseObstacles(harness, 0))[0]!;
  const straight = await shootLevelAt(harness, upright);
  expect(straight.hit, "the upright shot reaches the obstacle").toBe(true);
  expect(
    angleBetween(straight, reflectedLevel(upright.theta)),
    "an upright face returns the shot level",
  ).toBeLessThanOrEqual(ANGLE_TOLERANCE);
  expect(straight.speed).toBeCloseTo(SERVE_SPEED, 3);

  // 2. The same shot against the face turned a quarter turn.
  const tilted = (await poseObstacles(harness, TILT_T))[0]!;
  const deflected = await captureReplay(harness, "oriented", async () => {
    const shot = await shootLevelAt(harness, tilted);
    await harness.advance(DEPARTURE_TICKS);
    return shot;
  });
  expect(deflected.hit, "the tilted shot reaches the obstacle").toBe(true);
  expect(
    angleBetween(deflected, reflectedLevel(tilted.theta)),
    "a tilted face reflects the shot about its own normal",
  ).toBeLessThanOrEqual(ANGLE_TOLERANCE);
  expect(deflected.speed).toBeCloseTo(SERVE_SPEED, 3);

  // Nothing the page threw or logged as an error while this harness drove it.
  expect(harness.pageErrors).toEqual([]);
});
