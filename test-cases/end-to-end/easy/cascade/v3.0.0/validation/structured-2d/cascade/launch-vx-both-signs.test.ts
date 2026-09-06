// cascade/launch-vx-both-signs — cards launch to both sides.
//
// specs/victory.md gives each launch's `vx` "a sign chosen with equal
// probability", so a cascade throws cards to the left and to the right. The
// magnitude is `launch-vx-magnitude`; what this refuses is a build that fixed the
// sign, or that took the sign from something other than a draw, and so sends
// every card the same way.
//
// THE DRAW IS TAKEN ALONE. specs/instrumentation.md has `drawLaunchVx` perform
// exactly the draw a launch performs and nothing else, so the sign is read off
// that operation rather than off a whole cascade: sixty-four draws cost sixty-four
// calls, where fifty-two launches took nine seconds of game time frame by frame.
//
// WHY BOTH SIGNS AND NOT A BALANCE. "Equal probability" is a statement about a
// distribution, and sixty-four draws cannot decide one: any ratio a check
// demanded would fail some conformant builds by chance. What sixty-four draws CAN
// say, at a chance of one in 2^63 of being wrong, is that a build which always
// returns the same sign is not drawing a sign at all.
//
// The two directions are asserted separately so a failure names the side the
// build never throws to.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { captureStill, type Harness } from "../harness";
import { createFlightHarness, drawLaunches, poseDrawnFlight } from "./flight";

/**
 * How many draws are read.
 *
 * A fair sign lands all one way over this many with probability `2 / 2^64`,
 * which is `2^-63`: far beyond six standard deviations of a fair coin, so a
 * conformant build never fails here by chance.
 */
const DRAW_COUNT = 64;

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws a launch vx of both signs over sixty-four draws", async () => {
  harness.debug.reset();
  const speeds = drawLaunches(harness, DRAW_COUNT);

  await poseDrawnFlight(harness, speeds);
  captureStill(harness, "launches");

  const rightward = speeds.filter((vx) => vx > 0).length;
  const leftward = speeds.filter((vx) => vx < 0).length;

  assertGreaterThanOrEqual(
    rightward,
    1,
    `positive values, sending a card right, out of ${DRAW_COUNT} draws of drawLaunchVx()`,
  );
  assertGreaterThanOrEqual(
    leftward,
    1,
    `negative values, sending a card left, out of ${DRAW_COUNT} draws of drawLaunchVx()`,
  );
});
