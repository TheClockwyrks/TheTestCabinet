// cascade/launch-vy — a launched card leaves with the stated upward pop.
//
// specs/victory.md's launch table gives every launched card the same `vy`,
// `LAUNCH_VY`, which is negative because y grows downward: the card pops upward.
// Unlike `vx`, no part of it is drawn from the generator, so the figure is exact for
// every one of the fifty-two.
//
// It is read on the launching frame, where the card has not moved yet: "A card
// launched in a frame takes no motion in that frame" (specs/victory.md), so the
// frame's gravity has not been applied to it and the reading is the launch velocity
// itself.

import { afterEach, beforeEach, it } from "vitest";
import { LAUNCH_INTERVAL, LAUNCH_VY } from "../../src/constants";
import { assertCloseTo, assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startCascade,
  type Harness,
} from "../harness";
import { watchLaunches } from "./flight";

/**
 * How exactly the launch speed must be the stated one, as decimal places.
 *
 * `LAUNCH_VY` is a whole number the build is handed rather than a quantity it
 * integrates, so what this leaves room for is a float copied through an arithmetic
 * of the build's own, not a measurement.
 */
const LAUNCH_VY_DIGITS = 3;

/** Two intervals of room, so a slow clock is read rather than timed out. */
const MAX_FRAMES = framesFor(LAUNCH_INTERVAL * 3);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
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
    (seen) => seen.length >= 1,
  );
  captureStill(harness, "launch");

  assertGreaterThanOrEqual(
    launches.length,
    1,
    "cards launched by a running cascade, which this point needs one of",
  );
  assertCloseTo(
    launches[0].flyer.vy,
    LAUNCH_VY,
    LAUNCH_VY_DIGITS,
    "the vertical velocity a card launches with, in units per second",
  );
});
