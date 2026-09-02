// cascade/floor-bounce-keeps-vx — a bounce leaves the horizontal velocity alone.
//
// specs/victory.md, on the floor bounce: "`vx` is unchanged, so the card keeps
// its horizontal drift and each bounce peaks lower than the one before it." That
// is the whole of what this point reads. The reversal is
// `floor-bounce-reflects`, the damping `floor-bounce-damps`, the placement
// `floor-bounce-seats`, and the descending peaks `bounces-lose-height`.
//
// THE CARD IS GIVEN A DRIFT THE BOUNCE COULD PLAUSIBLY EAT. `250` units per
// second is a real horizontal speed rather than a token one, so a build that
// damped both components reads `200`, one that reflected both reads `-250`, and
// one that zeroed the drift on contact reads `0` — three different numbers, none
// of them within the millionth of a unit allowed below, because the rule is that
// the value is not touched at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { FLOOR_Y } from "../constants";
import {
  type Harness,
  captureStill,
  createHarness,
  flyerById,
  framesFor,
  poseFlyer,
  requireFlyer,
} from "../harness";
import { openFlight } from "./flight";

/** A card dropped from 300 units up, drifting right as it falls. */
const DROP = { x: 300, y: FLOOR_Y - 300, vx: 250, vy: 0 };

/** How far the sweep runs; the fall itself is 0.577 s. */
const SWEEP_FRAMES = framesFor(0.8);

/**
 * How far `vx` may move across the bounce, in units per second.
 *
 * The rule does not write `vx` at all, so the only slack the reading needs is
 * the rounding of a double through JSON.
 */
const DRIFT_TOLERANCE = 1e-6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("carries a flyer's vx through the floor bounce untouched", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, DROP);
  const before = requireFlyer(await harness.snapshot(), id, "posed drifting");

  const bounce = await harness.until((s) => (flyerById(s, id)?.vy ?? 0) < 0, {
    maxFrames: SWEEP_FRAMES,
  });
  await captureStill(harness, "bounce");

  assertEqual(bounce.hit, true, "the drifting card to bounce off the floor");
  const after = requireFlyer(bounce.snapshot, id, "bouncing off the floor");
  assertLessThanOrEqual(
    Math.abs(after.vx - before.vx),
    DRIFT_TOLERANCE,
    `the vx of the card across the bounce, which was ${before.vx} going in`,
  );
});
