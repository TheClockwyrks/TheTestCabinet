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
  ball0,
  captureReplay,
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

  const before = ball0(harness.snapshot()).speed;
  const bank = await captureReplay(harness, "bank", async () => {
    const rebound = await driveObstacleBounce(harness, "left");
    await harness.advance(DEPARTURE_TICKS);
    return rebound;
  });

  expect(bank.hit).toBe(true);
  expect(Math.abs(ball0(bank.snapshot).speed - before)).toBeLessThanOrEqual(
    SPEED_TOLERANCE,
  );
});
