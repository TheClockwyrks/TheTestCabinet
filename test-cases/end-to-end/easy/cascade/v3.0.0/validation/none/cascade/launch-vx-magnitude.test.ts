// cascade/launch-vx-magnitude — a launch's horizontal speed is in range.
//
// specs/victory.md's launch table fixes `vx` as "a magnitude drawn uniformly from
// `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]` (`[180, 420]`), with a sign chosen with equal
// probability". The magnitude is the whole of what this point reads; which SIDE a
// card goes is `launch-vx-both-signs`.
//
// ALL FIFTY-TWO LAUNCHES ARE READ, because the figure is a range over a random
// draw and one sample says almost nothing about it: a build drawing from
// `[0, 420]`, or from `[180, 1200]`, or handing every card the same speed, is
// only visible across the whole cascade. Nothing here asserts that the draw is
// uniform or that the range is covered — `specs/victory.md` fixes a distribution,
// and fifty-two samples cannot decide one without failing conformant builds by
// chance. What it fixes and what is read is that no launch leaves the range.
//
// A flyer's `vx` never changes after the launch (`specs/victory.md`'s five steps
// touch `vy`, `x` and `y`, and the bounce leaves `vx` alone), so the reading is
// the launch value however many frames later it is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { DECK_SIZE, LAUNCH_VX_MAX, LAUNCH_VX_MIN } from "../constants";
import { type Harness, captureStill, createHarness } from "../harness";
import { openCascade, readLaunches } from "./flight";

/**
 * The slack on each end of the range, in units per second.
 *
 * The range's ends are inclusive, so this admits nothing the specification
 * excludes; it is the rounding of a double through JSON, so a build that draws
 * exactly `LAUNCH_VX_MIN` is not failed for the last bit of a float.
 */
const RANGE_SLACK = 1e-6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("draws every launch's horizontal speed from [LAUNCH_VX_MIN, LAUNCH_VX_MAX]", async () => {
  await openCascade(harness);

  const launches = await readLaunches(harness, DECK_SIZE);
  await captureStill(harness, "launches");

  for (const launch of launches) {
    assertBetween(
      Math.abs(launch.flyer.vx),
      LAUNCH_VX_MIN - RANGE_SLACK,
      LAUNCH_VX_MAX + RANGE_SLACK,
      `the |vx| of launch ${launch.ordinal}, which was ${launch.flyer.vx}`,
    );
  }
});
