// rendering/trail-scales — a faster ball trails a longer streak.
//
// specs/overview.md: the trail is the ball's path over the last `TRAIL_TIME`
// seconds, so its length is proportional to the ball's speed. The same drive is
// run twice down the same lane, slow and then fast, and the two painted reaches
// compared (`./trail.ts` is the reading). This is the part a single reading
// cannot show: a build drawing a fixed-length tail can satisfy an absolute
// bound at one speed and fails here.
//
// The fast ball is over three times the slow one's speed, so its streak is over
// three times as long; the assertion asks only that it be longer, leaving the
// build's styling (a glow that lights a little of the lane at either speed) out
// of the comparison.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";
import { readTrail } from "./trail";

const SLOW = 260;
const FAST = 950;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("paints a longer streak behind a faster ball", async () => {
  const slow = await readTrail(h, SLOW);
  await captureStill(h, "slow");

  const fast = await readTrail(h, FAST);
  await captureStill(h, "fast");

  expect(slow.paintedReach).toBeGreaterThan(0);
  expect(fast.paintedReach).toBeGreaterThan(slow.paintedReach);
});
