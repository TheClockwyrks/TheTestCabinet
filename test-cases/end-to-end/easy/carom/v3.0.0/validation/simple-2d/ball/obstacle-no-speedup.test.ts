// ball/obstacle-no-speedup — an obstacle bounce does not speed the ball up.
//
// Only a paddle hit multiplies the ball's speed; a wall or obstacle bounce
// reflects it and leaves the magnitude alone. A ball is fired straight at one
// obstacle face at a known speed and the speeds either side of the real collision
// are compared. Sampled every frame, so the outgoing speed is read at the instant
// of the rebound with no stray flight in between — which is why the margin is a
// float margin rather than a tolerance.

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLES, OBSTACLE_CENTERS } from "../../src/constants";
import {
  arrangeObstacleBounce,
  createHarness,
  driveObstacleBounce,
  startPlaying,
  type Harness,
} from "../harness";

const FACE_X = OBSTACLES[0].x0;
const LANE_Y = OBSTACLE_CENTERS[0].y;
const APPROACH_SPEED = 600;
/** The reflection only rotates the velocity, so this is float noise, not slack. */
const SPEED_TOLERANCE = 0.5;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("leaves the ball's speed unchanged through an obstacle bounce", async () => {
  await startPlaying(harness);
  arrangeObstacleBounce(harness, {
    faceX: FACE_X,
    y: LANE_Y,
    from: "left",
    speed: APPROACH_SPEED,
  });

  const before = harness.snapshot().ball.speed;
  const bank = await driveObstacleBounce(harness, "left");

  expect(bank.hit).toBe(true);
  expect(Math.abs(bank.snapshot.ball.speed - before)).toBeLessThanOrEqual(
    SPEED_TOLERANCE,
  );
});
