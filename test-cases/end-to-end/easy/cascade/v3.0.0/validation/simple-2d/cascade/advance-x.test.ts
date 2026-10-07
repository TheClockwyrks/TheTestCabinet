// cascade/advance-x — a card in flight advances by its horizontal velocity.
//
// specs/victory.md's second per-frame step is `x += vx * dt`. Nothing else in the
// five steps touches `x`: gravity is vertical, the floor bounce leaves the
// horizontal velocity alone, and a card collides with nothing. So over a span of `t`
// seconds a card in flight travels `vx * t` horizontally, whatever the frames it was
// divided into.
//
// THE SPAN IS CHOSEN SO THE CARD NEITHER RETIRES NOR BOUNCES. It starts well inside
// the left half of the stage and ends well inside the right, so no side edge is
// approached; it is dropped from high enough that it is still above `FLOOR_Y` at the
// end, so nothing intervenes. The reading is a difference, so the pose's own `x`
// cancels.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import {
  captureReplay,
  createHarness,
  flyerOf,
  framesFor,
  seconds,
  type Harness,
} from "../harness";
import { openFlight, poseFlyer } from "./flight";

/** The span the travel is integrated over, in seconds. */
const HOLD_SECONDS = 0.5;
const HOLD_FRAMES = framesFor(HOLD_SECONDS);
/** The span the frames actually cover, which is what the travel is held against. */
const HOLD = seconds(HOLD_FRAMES);

/**
 * Where the card starts, and how fast.
 *
 * A horizontal speed inside the range a launch draws from (specs/victory.md), so the
 * flight read is one the game itself produces. Over the span the card crosses from
 * `x` 200 to about 400 and falls from `y` 100 to about 327, so it stays clear of both
 * side edges and of `FLOOR_Y` (580).
 */
const START = { x: 200, y: 100, vx: 400, vy: 0 };

/** The horizontal travel the span owes, in logical units. */
const EXPECTED_TRAVEL = START.vx * HOLD;

/** Two percent of it, which is the figure this point is stated at. */
const TRAVEL_TOLERANCE = 0.02 * Math.abs(EXPECTED_TRAVEL);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("carries a card in flight by its horizontal velocity", async () => {
  openFlight(harness);
  const id = poseFlyer(harness, START);
  const before = flyerOf(harness.snapshot(), id).x;

  const after = await captureReplay(harness, "travel", async () => {
    await harness.advance(HOLD_FRAMES);
    return flyerOf(harness.snapshot(), id).x;
  });

  assertBetween(
    after - before,
    EXPECTED_TRAVEL - TRAVEL_TOLERANCE,
    EXPECTED_TRAVEL + TRAVEL_TOLERANCE,
    `the horizontal travel over ${HOLD} s, in logical units`,
  );
});
