// ball/bounce-b-left — the ball reflects off obstacle B's left face.
//
// The ball is fired level with the obstacle, straight at that face; the build's
// own collision code reflects it. It must reverse its horizontal direction and
// stay on the near (left) side of the struck face — a reflection, not a pass
// through. The other three faces are the sibling checks, so a build that resolves
// only some of them fails exactly the ones it gets wrong.

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLES, OBSTACLE_CENTERS } from "../../src/constants";
import {
  arrangeObstacleBounce,
  createHarness,
  driveObstacleBounce,
  startPlaying,
  type Harness,
} from "../harness";

const FACE_X = OBSTACLES[1].x0;
const LANE_Y = OBSTACLE_CENTERS[1].y;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness.dispose();
});

it("banks the ball off obstacle B's left face", async () => {
  await startPlaying(harness);
  arrangeObstacleBounce(harness, { faceX: FACE_X, y: LANE_Y, from: "left" });

  const bank = await driveObstacleBounce(harness, "left");

  expect(bank.hit).toBe(true);
  expect(bank.snapshot.ball.x).toBeLessThan(FACE_X);
});
