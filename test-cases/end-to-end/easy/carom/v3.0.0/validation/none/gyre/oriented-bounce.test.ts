// gyre/oriented-bounce — the ball bounces off an obstacle's TILTED face at an
// angle that tracks that obstacle's current orientation, rather than at an
// axis-aligned reflection.
//
// The check is a contrast, driven twice with the same purely-horizontal shot at
// obstacle A's own center:
//
//   * upright (obstacle clock 0) — a vertical face, so the shot comes straight
//     back and picks up essentially no vertical velocity;
//   * tilted (obstacle clock posed to about 45 degrees) — an oriented face, so
//     the same shot leaves well off-axis.
//
// An axis-aligned obstacle can only ever flip `vx` here, whatever it is doing,
// so a build that reflects against the upright box no matter how it DRAWS its
// obstacles fails the tilted half while passing the upright one. That contrast
// is the point: neither shot alone would prove anything.
//
// Both shots are the build's own physics — the ball is posed and then flown, and
// the outgoing velocity is read at the instant the bounce resolves.

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

/** The clock time that presents a face turned a quarter turn from upright. */
const TILT_T = Math.PI / 4 / OBSTACLE_SPIN_RATE;

/** How far off-axis the tilted bounce must send the ball, in px/s. */
const DEFLECT_MIN = 80;

/** How straight the upright bounce must come back, in px/s. */
const STRAIGHT_MAX = 40;

/**
 * Fire a level shot at obstacle A's own center and report the ball's velocity at
 * the instant the bounce resolves.
 *
 * The bounce is detected as "the velocity turned away from the launch": either
 * the horizontal component reversed (an upright face) or a real vertical one
 * appeared (a tilted face). One predicate covers both, so neither outcome is
 * assumed by the way the shot is watched.
 */
async function shootLevelAt(
  h: Harness,
  obstacle: ObstaclePose,
): Promise<{ hit: boolean; vx: number; vy: number }> {
  await h.debug.setBall(0, {
    x: obstacle.cx - 220,
    y: obstacle.cy,
    vx: SERVE_SPEED,
    vy: 0,
    spin: 0,
  });
  const r = await h.until(
    (s) =>
      ball0(s).vx < SERVE_SPEED * 0.6 || Math.abs(ball0(s).vy) > DEFLECT_MIN,
    { maxFrames: 120, poll: 1 },
  );
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

afterEach(async () => {
  await harness.dispose();
});

it("deflects off a tilted face and returns straight off an upright one", async () => {
  await startPlaying(harness);

  // 1. Upright control. A vertical face returns a level shot level.
  const upright = (await poseObstacles(harness, 0))[0]!;
  const straight = await shootLevelAt(harness, upright);
  expect(straight.hit, "the upright shot should reach the obstacle").toBe(true);
  expect(straight.vx, "an upright face should send the shot back").toBeLessThan(
    0,
  );
  expect(
    Math.abs(straight.vy),
    "an upright face should add essentially no vertical velocity",
  ).toBeLessThan(STRAIGHT_MAX);

  // 2. The same shot against a face turned a quarter turn.
  const tilted = (await poseObstacles(harness, TILT_T))[0]!;
  const deflected = await captureReplay(harness, "oriented", async () => {
    const shot = await shootLevelAt(harness, tilted);
    await harness.advance(DEPARTURE_TICKS);
    return shot;
  });
  expect(deflected.hit, "the tilted shot should reach the obstacle").toBe(true);
  expect(
    Math.abs(deflected.vy),
    "a tilted face should deflect the shot well off-axis",
  ).toBeGreaterThan(DEFLECT_MIN);

  // The contrast itself, stated: the tilted face turned the ball far further off
  // level than the upright one did.
  expect(Math.abs(deflected.vy)).toBeGreaterThan(Math.abs(straight.vy) + 60);

  // Nothing the page threw or logged as an error while this harness drove it.
  expect(harness.pageErrors).toEqual([]);
});
