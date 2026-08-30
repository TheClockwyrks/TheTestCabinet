// cascade/gravity — gravity accelerates a card in flight at the stated rate.
//
// specs/victory.md's first per-frame step is `vy += GRAVITY * dt`, with `GRAVITY` in
// logical units per second squared and `dt` the frame's own delta in seconds. Over a
// span of `t` seconds the vertical velocity therefore grows by `GRAVITY * t`,
// whatever the frames it was divided into, and that is what is read here.
//
// THE CARD IS HELD STILL HORIZONTALLY AND KEPT OFF THE FLOOR. `vx` is zero, so
// nothing can carry the card past a side edge and retire it mid-reading; the start
// and the launch speed are chosen so the card is still above `FLOOR_Y` at the end of
// the span, so no bounce touches `vy` and what the reading measures is gravity
// alone.
//
// The span is read as the DIFFERENCE between two velocities rather than against an
// absolute figure, so the pose's own `vy` cancels and a build is held to the
// acceleration and to nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { GRAVITY } from "../../src/constants";
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

/** The span the acceleration is integrated over, in seconds. */
const HOLD_SECONDS = 0.5;
const HOLD_FRAMES = framesFor(HOLD_SECONDS);
/** The span the frames actually cover, which is what the growth is held against. */
const HOLD = seconds(HOLD_FRAMES);

/**
 * Where the card starts, and how fast.
 *
 * It is thrown upward and caught on the way back down, so the span covers the
 * turnaround and a build that accelerates in one direction only reads short. Over
 * the span the card travels from `y` 100 up to about 56 and back to 125, which is
 * clear of `FLOOR_Y` (580) throughout, so no bounce enters the reading.
 */
const START = { x: 590, y: 100, vx: 0, vy: -400 };

/** The growth in vertical velocity the span owes, in units per second. */
const EXPECTED_GROWTH = GRAVITY * HOLD;

/** Two percent of it, which is the figure this point is stated at. */
const GROWTH_TOLERANCE = 0.02 * EXPECTED_GROWTH;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("accelerates a card in flight downward at the stated rate", async () => {
  openFlight(harness);
  const id = poseFlyer(harness, START);
  const before = flyerOf(harness.snapshot(), id).vy;

  const after = await captureReplay(harness, "fall", async () => {
    await harness.advance(HOLD_FRAMES);
    return flyerOf(harness.snapshot(), id).vy;
  });

  assertBetween(
    after - before,
    EXPECTED_GROWTH - GROWTH_TOLERANCE,
    EXPECTED_GROWTH + GROWTH_TOLERANCE,
    `the growth in vertical velocity over ${HOLD} s, in units per second`,
  );
});
