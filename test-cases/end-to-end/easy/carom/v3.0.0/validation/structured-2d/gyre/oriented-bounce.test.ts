// gyre/oriented-bounce — the ball bounces off an obstacle's TILTED face at an
// angle that tracks that obstacle's current orientation, rather than at an
// axis-aligned reflection.
//
// The check is driven twice with the same level shot at obstacle A's own
// center: upright (obstacle clock 0), and tilted (the clock posed so that
// `theta = pi / 4`). specs/playfield.md fixes the outcome: a level shot at the
// center height meets the long face, whose local normal `(-1, 0)` rotates to
// the world normal `(-cos theta, -sin theta)`, and the velocity reflects about
// it: the direction `(1, 0)` leaves as `(-cos 2theta, -sin 2theta)`. Upright
// that is straight back; at a quarter turn it is straight up the field. Each
// reading is held to that direction within the review item's 3 degrees.
//
// Both shots are the build's own physics: the ball is posed and then flown, and
// the outgoing velocity is read at the instant the bounce resolves.
//
// The field holds ONE ball and obstacle A alone. Obstacle B is off the field
// rather than pinned still or parked: a shot that missed the struck face could
// otherwise bank off it and read as this check's rebound. The two paddles cannot
// be removed, so they are held out of both shot lanes.
//
// Where the shot is AIMED is read back off the snapshot rather than computed
// here. Obstacle A's swayed center at the tilt time is `obstacles-sway`'s point,
// not this one's, so this check fires at wherever the build put the obstacle and
// grades only the angle it comes away at.

import { afterEach, beforeEach, it } from "vitest";
import { OBSTACLE_SPIN_RATE, SERVE_SPEED } from "../constants";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import {
  ball0,
  captureReplay,
  createHarness,
  openIsolatedPlay,
  parkPaddles,
  type Harness,
} from "../harness";
import { obstacleAt, poseObstacles, type ObstaclePose } from "./harness";

/** The obstacle this check fires at, in the order of `OBSTACLE_CENTERS`. */
const OBSTACLE_A = 0;

/** The clock time that presents a face turned a quarter turn from upright. */
const TILT_T = Math.PI / 4 / OBSTACLE_SPIN_RATE;

/** The review item's margin on the outgoing direction, in degrees. */
const ANGLE_TOLERANCE_DEG = 3;

/** The margin on the posed tilt itself, in radians: `obstacles-spin`'s figure. */
const TILT_TOLERANCE = 0.01;

/** The specified outgoing direction of a level shot off a face turned `theta`. */
function reflectedHeading(theta: number): { x: number; y: number } {
  return { x: -Math.cos(2 * theta), y: -Math.sin(2 * theta) };
}

/** The angle between a velocity and a direction, in degrees. */
function degreesOff(
  v: { vx: number; vy: number },
  heading: { x: number; y: number },
): number {
  const dot = (v.vx * heading.x + v.vy * heading.y) / Math.hypot(v.vx, v.vy);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

/**
 * Fire a level shot at obstacle A's own center and report the ball's velocity at
 * the instant the bounce resolves.
 *
 * Three atomic poses put the ball on the lane — where it is, how fast it travels
 * and that it carries no spin — and the flight from there is the build's own.
 *
 * The bounce is detected as "the velocity turned away from the launch": the
 * horizontal component no longer the full launch speed, which covers both a
 * reversal off an upright face and a deflection off a tilted one.
 */
async function shootLevelAt(
  h: Harness,
  obstacle: ObstaclePose,
): Promise<{ hit: boolean; vx: number; vy: number }> {
  h.debug.setBallPosition(obstacle.cx - 220, obstacle.cy);
  h.debug.setBallVelocity(SERVE_SPEED, 0);
  h.debug.setBallSpin(0);
  const r = await h.until((s) => ball0(s).vx < SERVE_SPEED * 0.6, {
    maxFrames: 120,
    poll: 1,
  });
  return { hit: r.hit, vx: ball0(r.snapshot).vx, vy: ball0(r.snapshot).vy };
}

/**
 * Frames of the deflected flight recorded after the bounce resolves.
 *
 * `shootLevelAt` returns on the frame the velocity first turns away from the
 * launch, which is where the outgoing velocity has to be read — a frame later and
 * a second contact could have changed it. That makes it the wrong place to stop
 * RECORDING: the review item promises "a shot deflecting off a tilted obstacle",
 * and a deflection is an angle, which is only visible once the ball has flown
 * along it.
 */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("reflects a level shot about the face's normal, upright and tilted", async () => {
  await openIsolatedPlay(harness, {
    contents: { balls: 1, obstacles: [OBSTACLE_A] },
  });
  parkPaddles(harness);

  // 1. Upright: a vertical face returns the level shot level.
  const upright = obstacleAt(await poseObstacles(harness, 0), OBSTACLE_A);
  const straight = await shootLevelAt(harness, upright);
  assertEqual(straight.hit, true, "the upright shot should reach the obstacle");
  assertLessThanOrEqual(
    degreesOff(straight, reflectedHeading(0)),
    ANGLE_TOLERANCE_DEG,
    "an upright face should send the shot straight back",
  );

  // 2. The same shot against the face turned a quarter turn.
  const tilted = obstacleAt(await poseObstacles(harness, TILT_T), OBSTACLE_A);
  // The scenario's own precondition: the posed clock really did present a face
  // a quarter turn from upright, which is what the reflection below is read
  // against.
  assertLessThanOrEqual(
    Math.abs(tilted.theta - Math.PI / 4),
    TILT_TOLERANCE,
    "the posed clock should turn the obstacle a quarter turn from upright",
  );
  const deflected = await captureReplay(harness, "oriented", async () => {
    const shot = await shootLevelAt(harness, tilted);
    await harness.advance(DEPARTURE_TICKS);
    return shot;
  });
  assertEqual(deflected.hit, true, "the tilted shot should reach the obstacle");
  assertLessThanOrEqual(
    degreesOff(deflected, reflectedHeading(Math.PI / 4)),
    ANGLE_TOLERANCE_DEG,
    "a tilted face should send the shot along the reflection about its normal",
  );

  assertDeepEqual(harness.assetFailures, []);
});
