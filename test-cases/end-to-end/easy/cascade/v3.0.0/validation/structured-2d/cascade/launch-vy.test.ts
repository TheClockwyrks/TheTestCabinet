// cascade/launch-vy — a launched card leaves with the stated upward pop.
//
// specs/victory.md's launch table gives every launched card the same `vy`,
// `LAUNCH_VY`, which is negative because y grows downward: the card pops upward.
// Unlike `vx`, no part of it is drawn from the generator, so the figure is exact
// for every one of the fifty-two.
//
// It is read on the launching frame, where the card has not moved yet: "A card
// launched in a frame takes no motion in that frame" (specs/victory.md), so the
// frame's gravity has not been applied to it and the reading is the launch
// velocity itself.
//
// THE FIRST FOUR LAUNCHES ARE READ, one from each foundation, so a build that
// gave one slot a different pop — or that got the opening launch right and every
// later one wrong — is caught rather than sampled around. The `none` suite reads
// the same four.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertGreaterThanOrEqual } from "../assert";
import { FOUNDATION_COUNT, LAUNCH_INTERVAL, LAUNCH_VY } from "../constants";
import { captureStill, startCascade, type Harness } from "../harness";
import { createFlightHarness, flightFrames, watchLaunches } from "./flight";

/**
 * How exactly the launch speed must be the stated one, as decimal places.
 *
 * `LAUNCH_VY` is a whole number the build is handed rather than a quantity it
 * integrates, so what this leaves room for is a float copied through an
 * arithmetic of the build's own, not a measurement.
 */
const LAUNCH_VY_DIGITS = 3;

/** Two intervals of room past the four launches, so a slow clock is read rather than timed out. */
const MAX_FRAMES = flightFrames(LAUNCH_INTERVAL * (FOUNDATION_COUNT + 2));

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("pops a launched card upward at the stated speed", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const launches = await watchLaunches(
    harness,
    MAX_FRAMES,
    (seen) => seen.length >= FOUNDATION_COUNT,
  );
  captureStill(harness, "launch");

  assertGreaterThanOrEqual(
    launches.length,
    FOUNDATION_COUNT,
    `cards launched by a running cascade, one for each of the ${FOUNDATION_COUNT} foundations`,
  );

  for (const [ordinal, launch] of launches.entries()) {
    assertCloseTo(
      launch.flyer.vy,
      LAUNCH_VY,
      LAUNCH_VY_DIGITS,
      `the vertical velocity the card launch ${ordinal} took from foundation ${launch.foundation} left with, in units per second`,
    );
  }
});
