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
  ball0,
  captureReplay,
  createHarness,
  driveObstacleBounce,
  startPlaying,
  type Harness,
} from "../harness";

const FACE_X = OBSTACLES[1].x0;
const LANE_Y = OBSTACLE_CENTERS[1].y;

/**
 * Frames of the departing flight recorded after the rebound.
 *
 * The sweep that drives the bank stops on the frame the ball's horizontal
 * velocity reverses — the frame of the contact itself. A recording that ended
 * there would show the ball arriving and nothing more, and the review item
 * promises a reviewer a BANK: the leg that leaves the face is half of what the
 * clip is for. Half a second of it is enough to read the outgoing angle off and
 * short enough that the ball is still on the field at the end.
 *
 * These frames are driven AFTER the sweep, inside the same recorded section, so
 * the rebound the assertions read is still the sweep's own frame.
 */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("banks the ball off obstacle B's left face", async () => {
  await startPlaying(harness);
  arrangeObstacleBounce(harness, { faceX: FACE_X, y: LANE_Y, from: "left" });

  const bank = await captureReplay(harness, "bank", async () => {
    const rebound = await driveObstacleBounce(harness, "left");
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  expect(bank.hit).toBe(true);
  expect(ball0(bank.snapshot).x).toBeLessThan(FACE_X);
});
