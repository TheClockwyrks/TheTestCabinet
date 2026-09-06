// cascade/launch-vx-magnitude — a launch's horizontal speed is in range.
//
// specs/victory.md fixes each launch's `vx` as "a magnitude drawn uniformly from
// `[LAUNCH_VX_MIN, LAUNCH_VX_MAX]` (`[180, 420]`), with a sign chosen with equal
// probability". The magnitude is the whole of what this point reads; which SIDE
// a card goes is `launch-vx-both-signs`.
//
// THE DRAW IS TAKEN ALONE. specs/instrumentation.md has `drawLaunchVx` perform
// exactly the draw a launch performs and nothing else, so the magnitude is read
// off that operation rather than off a whole cascade: a handful of draws cost a
// handful of calls, where fifty-two launches took nine seconds of game time frame
// by frame.
//
// A HANDFUL OF DRAWS ARE READ, because the figure is a range over a random draw
// and one sample says little about it: a build drawing from `[0, 420]`, or from
// `[180, 1200]`, is visible only across several draws. Nothing here asserts that
// the draw is uniform or that the range is covered — specs/victory.md fixes a
// distribution, and a sample cannot decide one without failing conformant builds
// by chance. What it fixes and what is read is that no draw leaves the range.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { LAUNCH_VX_MAX, LAUNCH_VX_MIN } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { drawLaunches, poseDrawnFlight } from "./flight";

/** How many draws are read. Every one of them is held to the range. */
const DRAW_COUNT = 8;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws every launch's horizontal speed from the stated range", async () => {
  harness.debug.reset();
  const speeds = drawLaunches(harness, DRAW_COUNT);

  await poseDrawnFlight(harness, speeds);
  captureStill(harness, "launches");

  for (const [index, vx] of speeds.entries()) {
    assertBetween(
      Math.abs(vx),
      LAUNCH_VX_MIN,
      LAUNCH_VX_MAX,
      `draw ${index + 1} of ${DRAW_COUNT} of drawLaunchVx(): the |vx| it drew`,
    );
  }
});
