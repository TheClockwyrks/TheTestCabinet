// cascade/launch-vx-magnitude — every launched card's horizontal speed is in range.
//
// specs/victory.md's launch table draws each card's `vx` as "a magnitude drawn
// uniformly from [LAUNCH_VX_MIN, LAUNCH_VX_MAX], with a sign chosen with equal
// probability". The sign is `launch-vx-both-signs`; the magnitude is this, and it
// is read over a whole cascade rather than over one launch, because a single draw
// says nothing about a range.
//
// WHAT IS ASSERTED IS THE RANGE, OVER EVERY LAUNCH THIS RUN CARRIED. That the run
// carries all fifty-two is `cascade-completes`, and a build that stops launching
// early is not docked twice here; what this refuses is a build that draws a
// magnitude outside the stated range, and a run that launched nothing at all,
// which leaves the point nothing to decide and is therefore a failure rather than
// a vacuous pass.
//
// The magnitude is read on each card's launching frame. `vx` is never touched by
// gravity or by a bounce (specs/victory.md), so a later reading would agree in a
// conformant build; reading it at the launch keeps the point from failing over a
// build that alters `vx` in flight, which is `floor-bounce-keeps-vx`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThanOrEqual } from "../assert";
import {
  DECK_SIZE,
  LAUNCH_INTERVAL,
  LAUNCH_VX_MAX,
  LAUNCH_VX_MIN,
} from "../constants";
import { captureStill, startCascade, type Harness } from "../harness";
import { createFlightHarness, flightFrames, watchLaunches } from "./flight";

/**
 * The frames a whole deck of launches takes, with three intervals to spare.
 *
 * The fifty-second launch falls fifty-one intervals after the first
 * (specs/victory.md), so a deck's worth of intervals covers the run and leaves
 * room for a clock running slightly slow.
 */
const MAX_FRAMES = flightFrames(LAUNCH_INTERVAL * (DECK_SIZE + 3));

let harness: Harness;

beforeEach(async () => {
  harness = await createFlightHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws every launch's horizontal speed from the stated range", async () => {
  startCascade(harness);
  harness.debug.setTrailPainting(false);

  const launches = await watchLaunches(
    harness,
    MAX_FRAMES,
    (seen) => seen.length >= DECK_SIZE,
  );
  captureStill(harness, "launches");

  assertGreaterThanOrEqual(
    launches.length,
    1,
    "cards launched by a running cascade, which this point needs at least one of",
  );
  for (const [at, launch] of launches.entries()) {
    assertBetween(
      Math.abs(launch.flyer.vx),
      LAUNCH_VX_MIN,
      LAUNCH_VX_MAX,
      `launch ${at + 1} of ${launches.length}: the horizontal speed it left with`,
    );
  }
});
