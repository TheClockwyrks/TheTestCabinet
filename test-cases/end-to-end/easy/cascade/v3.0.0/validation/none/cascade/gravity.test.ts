// cascade/gravity — gravity accelerates a card in flight at 1800.
//
// specs/victory.md's first step of every frame of a running cascade is
// `vy += GRAVITY * dt`, with `GRAVITY` being `1800`. Over half a second that is
// `900` units per second of downward velocity, whatever the card was doing
// before, and whatever the frames the half second was covered in — every rate in
// this case is per second and integrated against the frame's delta
// (`specs/overview.md`).
//
// THE CARD IS POSED SO THAT NOTHING ELSE CAN TOUCH `vy`. It is dropped from rest
// high on an empty table with no horizontal drift: the only other step that
// writes `vy` is the floor bounce, and a card released at `y = 40` falls `225`
// units in half a second, which is `315` short of `FLOOR_Y` (`580`). Nothing is
// launching, so the reading is of one parabola rather than of fifty-two. The
// horizontal component is left at zero so the card cannot reach a side edge and
// retire mid-reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { GRAVITY } from "../constants";
import {
  type Harness,
  captureReplay,
  createHarness,
  framesFor,
  poseFlyer,
  requireFlyer,
} from "../harness";
import { openFlight } from "./flight";

/** The card is dropped from rest, high enough that it never reaches the floor. */
const DROP = { x: 400, y: 40, vx: 0, vy: 0 };

/** The span the acceleration is read over, in seconds of game time. */
const SPAN = 0.5;

/** What `GRAVITY` adds to `vy` over that span: 900 units per second. */
const EXPECTED_GAIN = GRAVITY * SPAN;

/**
 * Two percent of that gain, 18 units per second.
 *
 * The integration is a sum of 120 equal steps, so the arithmetic itself is exact
 * to a rounding error; two percent is room for a build that integrates in a
 * different order or carries the delta in milliseconds, and it is far tighter
 * than the difference between `1800` and any neighbouring figure a build might
 * have reached for.
 */
const GAIN_TOLERANCE = EXPECTED_GAIN * 0.02;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("adds GRAVITY * dt to a flyer's vy every frame", async () => {
  await openFlight(harness);
  const id = await poseFlyer(harness, DROP);
  const before = requireFlyer(await harness.snapshot(), id, "posed at rest");

  await captureReplay(harness, "fall", () => harness.advance(framesFor(SPAN)));

  const after = requireFlyer(
    await harness.snapshot(),
    id,
    `falling for ${SPAN} s`,
  );
  assertLessThanOrEqual(
    Math.abs(after.vy - before.vy - EXPECTED_GAIN),
    GAIN_TOLERANCE,
    `vy to grow by GRAVITY * ${SPAN} (${EXPECTED_GAIN}) over ${SPAN} s, and it grew by ${after.vy - before.vy}`,
  );
});
