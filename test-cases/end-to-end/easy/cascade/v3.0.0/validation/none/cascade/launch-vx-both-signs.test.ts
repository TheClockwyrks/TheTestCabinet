// cascade/launch-vx-both-signs — cards launch to both sides.
//
// specs/victory.md's launch table gives a launch's `vx` "a sign chosen with equal
// probability". Over enough draws both signs therefore occur, and cards leave the
// table past both edges rather than all drifting one way. That is what this
// point reads, and the SIZE of the speed is `launch-vx-magnitude`'s.
//
// THE DRAW IS TAKEN ALONE. `specs/instrumentation.md` has `drawLaunchVx` perform
// exactly the draw a launch performs and nothing else, so the sign is read off
// that operation rather than off a whole cascade: sixty-four draws go over in one
// crossing, where fifty-two launches took nine seconds of game time driven frame
// by frame.
//
// WHY BOTH SIGNS AND NOT A BALANCE. "Equal probability" is a statement about a
// distribution, and sixty-four draws cannot decide one: any ratio a check
// demanded would fail some conformant builds by chance. What sixty-four draws
// CAN say, at a chance of one in 2^63 of being wrong, is that a build which
// always returns the same sign is not drawing a sign at all — a build that
// dropped the sign, or took `Math.abs`, or used a constant, reads one sign
// sixty-four times.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { type Harness, captureStill, createHarness } from "../harness";
import { drawLaunches, poseDrawnFlight } from "./flight";

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
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("draws a launch vx of both signs over sixty-four draws", async () => {
  await harness.debug.reset();
  const speeds = await drawLaunches(harness, DRAW_COUNT);

  await poseDrawnFlight(harness, speeds);
  await captureStill(harness, "launches");

  const left = speeds.filter((vx) => vx < 0).length;
  const right = speeds.filter((vx) => vx > 0).length;

  assertTrue(
    left > 0,
    `at least one of ${DRAW_COUNT} draws of drawLaunchVx() to be negative, ` +
      `sending its card left, and ${left} were`,
  );
  assertTrue(
    right > 0,
    `at least one of ${DRAW_COUNT} draws of drawLaunchVx() to be positive, ` +
      `sending its card right, and ${right} were`,
  );
});
