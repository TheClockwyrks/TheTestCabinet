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

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLE_SPIN_RATE, SERVE_SPEED } from "../../src/constants";
import {
  ball0,
  captureReplay,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { poseObstacles, type ObstaclePose } from "./harness";

/** The clock time that presents a face turned a quarter turn from upright. */
const TILT_T = Math.PI / 4 / OBSTACLE_SPIN_RATE;

/** The review item's margin on the outgoing direction, in degrees. */
const ANGLE_TOLERANCE_DEG = 3;

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
 * The bounce is detected as "the velocity turned away from the launch": the
 * horizontal component no longer the full launch speed, which covers both a
 * reversal off an upright face and a deflection off a tilted one.
 */
async function shootLevelAt(
  h: Harness,
  obstacle: ObstaclePose,
): Promise<{ hit: boolean; vx: number; vy: number }> {
  h.debug.setBall(0, {
    x: obstacle.cx - 220,
    y: obstacle.cy,
    vx: SERVE_SPEED,
    vy: 0,
    spin: 0,
  });
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
  await startPlaying(harness);

  // 1. Upright: a vertical face returns the level shot level.
  const upright = (await poseObstacles(harness, 0))[0]!;
  const straight = await shootLevelAt(harness, upright);
  expect(straight.hit, "the upright shot should reach the obstacle").toBe(true);
  expect(
    degreesOff(straight, reflectedHeading(0)),
    "an upright face should send the shot straight back",
  ).toBeLessThanOrEqual(ANGLE_TOLERANCE_DEG);

  // 2. The same shot against the face turned a quarter turn.
  const tilted = (await poseObstacles(harness, TILT_T))[0]!;
  expect(Math.abs(tilted.theta - Math.PI / 4)).toBeLessThanOrEqual(0.01);
  const deflected = await captureReplay(harness, "oriented", async () => {
    const shot = await shootLevelAt(harness, tilted);
    await harness.advance(DEPARTURE_TICKS);
    return shot;
  });
  expect(deflected.hit, "the tilted shot should reach the obstacle").toBe(true);
  expect(
    degreesOff(deflected, reflectedHeading(Math.PI / 4)),
    "a tilted face should send the shot along the reflection about its normal",
  ).toBeLessThanOrEqual(ANGLE_TOLERANCE_DEG);

  expect(harness.assetFailures).toEqual([]);
});
