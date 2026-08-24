// ball/obstacle-no-speedup — an obstacle bounce does not speed the ball up.
//
// Only a paddle hit multiplies the ball's speed; "an obstacle bounce leaves
// speed and spin unchanged" (specs/playfield.md). A ball is fired straight at
// one obstacle face at a known speed and the speeds either side of the real
// collision are compared. Sampled every frame, so the outgoing speed is read at
// the instant of the rebound, and the review item's 0.1 percent is a float
// margin rather than slack.

import { afterEach, beforeEach, it } from "vitest";
import { OBSTACLES, OBSTACLE_CENTERS } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
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
/** The review item's margin: a tenth of a percent of the approach speed. */
const SPEED_TOLERANCE = APPROACH_SPEED * 0.001;

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

  assertEqual(bank.hit, true);
  assertLessThanOrEqual(
    Math.abs(ball0(bank.snapshot).speed - before),
    SPEED_TOLERANCE,
  );
});
