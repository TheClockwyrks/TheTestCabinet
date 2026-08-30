// cascade/launch-vy — a launched card pops upward at -120.
//
// specs/victory.md's launch table fixes `vy` as `LAUNCH_VY` (`-120`) for every
// launch, with no range and no randomness — the magnitude and the sign the
// seeded generator draws are the HORIZONTAL component's, which
// `launch-vx-magnitude` and `launch-vx-both-signs` read. And "a card launched in
// a frame takes no motion in that frame", so the frame a card launches on is the
// frame that reads its launch velocity before gravity has touched it.
//
// The first four launches are read, one from each foundation, so a build that
// gave one slot a different pop is caught rather than sampled around. The sign
// matters as much as the size: `-120` is upward on a stage whose `y` increases
// downward (`specs/overview.md`), and a build that popped cards downward reads
// `+120` and fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { FOUNDATION_COUNT, LAUNCH_VY } from "../constants";
import { type Harness, captureStill, createHarness } from "../harness";
import { openCascade, readLaunches } from "./flight";

/**
 * How far a launch's `vy` may sit from `LAUNCH_VY`, in units per second.
 *
 * The value is ASSIGNED at the launch and read on the same frame, with no
 * integration in between, so the only slack the reading needs is the rounding of
 * a double through JSON.
 */
const VY_TOLERANCE = 1e-6;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("gives every launched card a vy of LAUNCH_VY", async () => {
  await openCascade(harness);

  const launches = await readLaunches(harness, FOUNDATION_COUNT);
  await captureStill(harness, "launch");

  for (const launch of launches) {
    assertLessThanOrEqual(
      Math.abs(launch.flyer.vy - LAUNCH_VY),
      VY_TOLERANCE,
      `the vy of the card launch ${launch.ordinal} took from foundation ${launch.foundation}, which LAUNCH_VY fixes at ${LAUNCH_VY}`,
    );
  }
});
