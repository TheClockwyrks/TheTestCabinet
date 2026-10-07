// cascade/advance-y — a card in flight advances by its vertical velocity.
//
// specs/victory.md's second step of every frame is `y += vy * dt`, and it follows
// the first, `vy += GRAVITY * dt`. So one frame moves the card by the vy it is
// LEFT with times that frame's delta, and this reads exactly that: the `vy` the
// build reports at the end of the frame, times the frame.
//
// READ AGAINST THE BUILD'S OWN `vy`, DELIBERATELY. Whether the build's `vy` is
// the right number is `gravity`'s question, and reading the step against
// `GRAVITY` here would dock one wrong figure in two places. What this point
// decides is that the position follows the velocity at all.
//
// THE POSED `vy` IS THE DISTINGUISHING VALUE. `1200` units per second is a card
// well into its fall — the drop from the top row to the floor reaches `1415` — and
// it carries the card `5.03` units in one frame of `1/240` s. A build that never
// advanced `y` reads `0`, one that advanced by `vy` per frame reads `1207`, and
// one that advanced by `vx` reads `0` again; all three are far outside the one
// unit the review item allows. The card starts at the top of the stage, so the
// single frame cannot reach `FLOOR_Y` and no bounce can seat it.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  type Harness,
  captureStill,
  createHarness,
  poseFlyer,
  requireFlyer,
  seconds,
} from "../harness";
import { openFlight } from "./flight";

/** A card already falling fast, at the top of the stage. */
const FALLING = { x: 400, y: 0, vx: 0, vy: 1200 };

/** The frame the step is read over, in seconds. */
const FRAME = seconds(1);

/**
 * How far the step may sit from `vy * dt`, in logical units.
 *
 * The figure the review item states. It is a hundredth of the `5.03` units the
 * posed velocity carries the card in a frame, so it admits rounding and the
 * order a build applies the two steps in, and nothing else.
 */
const STEP_TOLERANCE = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("advances a flyer's y by its vy times the frame", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, FALLING);
  const before = requireFlyer(await harness.snapshot(), id, "posed in flight");

  await harness.advance(1);
  await captureStill(harness, "step");

  const after = requireFlyer(await harness.snapshot(), id, "after one frame");
  const expected = after.vy * FRAME;
  assertLessThanOrEqual(
    Math.abs(after.y - before.y - expected),
    STEP_TOLERANCE,
    `y to change by the frame's vy (${after.vy}) times ${FRAME} s, which is ${expected}, and it changed by ${after.y - before.y}`,
  );
});
