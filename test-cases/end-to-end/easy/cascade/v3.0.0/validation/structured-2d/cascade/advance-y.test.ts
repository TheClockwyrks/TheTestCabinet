// cascade/advance-y — a card in flight advances by its vertical velocity.
//
// specs/victory.md's second per-frame step is `y += vy * dt`, and it runs AFTER
// the first, `vy += GRAVITY * dt`, so the velocity a frame carries the card by is
// the one gravity has already acted on. One frame of a posed flight is therefore
// worth `(vy + GRAVITY * dt) * dt` of vertical travel, and that is what is read:
// one frame, one reading, no accumulation.
//
// THE TOLERANCE IS ONE LOGICAL UNIT, which this point is stated at, and the pose
// is chosen so that tolerance decides something. The frame's own gravity term is
// worth `GRAVITY * dt * dt`, a hundredth of the allowance at this group's step,
// so a build that moves the card by its pre-gravity velocity is inside the
// tolerance and passes deliberately: which of the two velocities a frame uses is a
// hair at any sane frame rate, and it is the ORDER of the steps rather than this
// reading that fixes it. What the tolerance refuses is a build that does not carry
// the card by its vertical velocity at all: the pose's `vy` is fast enough that a
// frame of it is several units, so a card left where it was, or moved by some
// other quantity, reads far outside.
//
// The card is held still horizontally and started well clear of the floor, so
// neither a side edge nor a bounce can enter a single frame's reading.

import { afterEach, beforeEach, it } from "vitest";
import { GRAVITY } from "../../src/constants";
import { assertBetween } from "../assert";
import { captureStill, type Harness } from "../harness";
import {
  createFlightHarness,
  flightSeconds,
  flyerOf,
  openFlight,
  poseFlight,
} from "./flight";

/** The frame's delta, in seconds: this group's own step. */
const DT = flightSeconds(1);

/**
 * Where the card starts, and how fast.
 *
 * A vertical speed of `-960` is fast enough that one frame of it is about four
 * logical units, four times the tolerance, so a build that leaves the card where
 * it was cannot pass. The card is well above the floor and held still
 * horizontally, so the frame carries nothing but the travel being read.
 */
const START = { x: 590, y: 300, vx: 0, vy: -960 };

/** The travel one frame owes, in logical units: the post-gravity velocity times dt. */
const EXPECTED_TRAVEL = (START.vy + GRAVITY * DT) * DT;

/** One logical unit, which is the figure this point is stated at. */
const TRAVEL_TOLERANCE = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("carries a card in flight by its vertical velocity in one frame", async () => {
  openFlight(harness);
  const id = poseFlight(harness, START);
  const before = flyerOf(harness.snapshot(), id).y;

  await harness.advance(1);
  const after = flyerOf(harness.snapshot(), id).y;
  captureStill(harness, "step");

  assertBetween(
    after - before,
    EXPECTED_TRAVEL - TRAVEL_TOLERANCE,
    EXPECTED_TRAVEL + TRAVEL_TOLERANCE,
    "the vertical travel of one frame, in logical units",
  );
});
