// Carom — rendering/trail-scales: a faster ball draws a longer trail.
//
// The trail is a fixed DURATION of travel, TRAIL_TIME seconds
// (specs/overview.md), so its length is proportional to speed. The same drive
// is run twice down the same empty lane, slow and then fast, and the lit run
// behind the ball is read off the canvas each time; the fast streak must be the
// longer. This is the reading a single drive cannot give: a build drawing a
// fixed-length tail passes every absolute bound and fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  driveTrail,
  trailReach,
  type Harness,
} from "../harness";

const SLOW = 260;
const FAST = 950;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a longer trail behind the faster ball", async () => {
  const slowBall = await driveTrail(h, SLOW);
  captureStill(h, "slow");
  const slow = trailReach(h, slowBall);

  const fastBall = await driveTrail(h, FAST);
  captureStill(h, "fast");
  const fast = trailReach(h, fastBall);

  assertGreaterThan(slow, 0);
  assertGreaterThan(fast, slow);
});
