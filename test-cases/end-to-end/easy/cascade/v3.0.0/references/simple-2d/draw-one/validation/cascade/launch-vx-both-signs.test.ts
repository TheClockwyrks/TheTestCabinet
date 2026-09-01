// cascade/launch-vx-both-signs — cards launch to both sides.
//
// specs/victory.md gives each launch's `vx` "a sign chosen with equal probability",
// so a cascade throws cards to the left and to the right. The magnitude is
// `launch-vx-magnitude`; what this refuses is a build that fixed the sign, or that
// took the sign from something other than a draw, and so sends every card the same
// way.
//
// IT IS READ OVER A WHOLE CASCADE. Fifty-two draws of a fair sign land all one way
// with probability one in `2^51`, so a conformant build that failed this would be a
// far rarer event than a machine fault; a shorter run would not carry that.
//
// The two directions are asserted separately so a failure names the side the build
// never threw to.

import { afterEach, beforeEach, it } from "vitest";
import { DECK_SIZE, LAUNCH_INTERVAL } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startCascade,
  type Harness,
} from "../harness";
import { watchLaunches } from "./flight";

/** A whole deck of launches, with three intervals to spare. */
const MAX_FRAMES = framesFor(LAUNCH_INTERVAL * (DECK_SIZE + 3));

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("throws launched cards to both sides", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const launches = await watchLaunches(
    harness,
    MAX_FRAMES,
    (seen) => seen.length >= DECK_SIZE,
  );
  captureStill(harness, "launches");

  const rightward = launches.filter((launch) => launch.flyer.vx > 0).length;
  const leftward = launches.filter((launch) => launch.flyer.vx < 0).length;

  assertGreaterThanOrEqual(
    rightward,
    1,
    `cards launched to the right, out of ${launches.length} launches`,
  );
  assertGreaterThanOrEqual(
    leftward,
    1,
    `cards launched to the left, out of ${launches.length} launches`,
  );
});
