// rendering/trail-length — the trail behind a ball in steady flight reaches
// back about `speed * TRAIL_TIME`.
//
// specs/overview.md: behind the ball, the build draws its path over the last
// `TRAIL_TIME` seconds of travel. A ball at a steady speed therefore trails a
// streak `speed * TRAIL_TIME` long, and that length is what is read: the lane
// behind the ball is scanned for the painted streak, against a reading of the
// same lane taken before the ball entered it (`./trail.ts`).
//
// THE BOUNDS. The streak is read where the build painted it, and how the build
// styles it is its own: a glow can light a little of the lane past the oldest
// sample, a taper can leave the oldest sample too faint to read. So the reach
// is bounded to [0.5, 1.5] times `speed * TRAIL_TIME`, plus up to two ball
// radii at the far end for the width of whatever mark is drawn there. A fixed
// decorative tail of a dozen units fails the lower bound at the speed driven
// here; a streak that stretches across the field fails the upper.

import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_R, TRAIL_TIME } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { readTrail } from "./trail";

/** A brisk rally speed, so the expected streak is long enough to read cleanly. */
const SPEED = 950;

const EXPECTED = SPEED * TRAIL_TIME;
const REACH_MIN = 0.5 * EXPECTED;
const REACH_MAX = 1.5 * EXPECTED + 2 * BALL_R;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints a streak behind the ball about speed times TRAIL_TIME long", async () => {
  const trail = await readTrail(h, SPEED);
  await captureStill(h, "trail");

  // And what landed on the canvas reaches back the trail's length.
  expect(trail.paintedReach).toBeGreaterThanOrEqual(REACH_MIN);
  expect(trail.paintedReach).toBeLessThanOrEqual(REACH_MAX);
});
