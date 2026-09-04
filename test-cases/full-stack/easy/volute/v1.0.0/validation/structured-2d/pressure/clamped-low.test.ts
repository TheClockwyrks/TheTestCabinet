// pressure/clamped-low — pressure stops at 0.
//
// WHAT THE SPEC FIXES. `specs/channel.md` ("Pressure") states the bound and the
// clamp: "`pressure` is a real number held between `0` and `100` inclusive,
// clamped at both ends", and the per-tick rule ends in
// `clamp(pressure + (rise - bleed) x dt, 0, 100)`. The same clamp is named again
// for the drop a removal pays, "clamped the same way", and `setPressure` is held
// to it too (`specs/instrumentation.md`: "clamped to `0` through `100`").
//
// THE DRIVE. An isolated hall with the inlet held, the pressure posed
// just above the floor at 0.5, and 10 cores on the channel in one segment. Ten is
// under `PRESSURE_FREE` (`24`), so `specs/channel.md` bleeds at the full 2.0 per
// second and rises by nothing: an unclamped build reaches -1.5 within the
// measured second while a clamped one stops at exactly 0. One segment cannot
// merge and no projectile exists, so nothing extracts and no removal pays a drop
// into the reading.
//
// WHAT IS ASSERTED. The bound alone, and on every tick of the second rather than
// only at its end, because the requirement is that pressure never falls below 0
// rather than that it arrives anywhere in particular. How fast it falls is
// `pressure/bleed`'s point, and folding that in here would fail a build twice for
// one defect.
//
// THE TOLERANCE. None, and deliberately so: a clamp is exact arithmetic on the
// value the build already holds, not an integration, so a conformant build
// reports at least exactly 0 on every tick. The standing pressure tolerance
// exists for a figure a build integrates toward; there is nothing to integrate in
// `max(0, x)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { PRESSURE_MIN, type ChargeId } from "../constants";
import {
  captureStill,
  coreCount,
  createHarness,
  poseHall,
  spacedBlock,
  type Harness,
} from "../harness";

/** Cores on the channel: well under `PRESSURE_FREE`, so the full bleed applies. */
const CORES = 10;

/**
 * The head of the posed block.
 *
 * 10 cores spaced by 28 span 252 units, so the block sits wholly inside the
 * channel with its tail at 748 and its head far short of the intake at 5000.
 */
const HEAD_S = 1000;

/** One second of simulation: enough for an unclamped build to undershoot by 1.5. */
const TICKS = 60;

/** The charge every posed core carries. Uniform, so no run can be completed. */
const CHARGE: ChargeId = "garnet";

/** A pressure half a unit above the floor, so a quarter-second of bleed meets it. */
const START_PRESSURE = 0.5;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("never reports a pressure below 0 under a bleed that would undershoot", async () => {
  await poseHall(harness, {
    level: 1,
    pressure: START_PRESSURE,
    cores: spacedBlock(HEAD_S, CORES, CHARGE),
  });

  const history = await harness.stepWatching(TICKS);

  // The gauge as the frame that ran last left it, which is the picture of the
  // HUD at the floor this point is about. Captured before the assertions, so a
  // failing build leaves the evidence that shows why.
  captureStill(harness, "gauge");

  assertEqual(
    coreCount(history[history.length - 1]),
    CORES,
    "the posed cores still on the channel after the measured second",
  );
  for (const [index, snapshot] of history.entries()) {
    assertGreaterThanOrEqual(
      snapshot.pressure,
      PRESSURE_MIN,
      `pressure on tick ${index + 1} of ${TICKS}`,
    );
  }
});
