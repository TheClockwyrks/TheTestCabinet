// pressure/clamped-high — pressure stops at 100.
//
// WHAT THE SPEC FIXES. `specs/channel.md` ("Pressure") states the bound and the
// clamp: "`pressure` is a real number held between `0` and `100` inclusive,
// clamped at both ends", and the per-tick rule ends in
// `clamp(pressure + (rise - bleed) x dt, 0, 100)`. `setPressure` is held to the
// same bound (`specs/instrumentation.md`: "Sets the pressure to `value`, clamped
// to `0` through `100`"), so no value a scenario poses can carry the reading past
// it either.
//
// THE DRIVE. An isolated hall with the quota stopped at 0, the pressure posed
// just under the ceiling at 99.9, and 100 cores on the channel in one segment.
// `max(0, 100 - 24) x 0.05` is a rise of 3.8 per second, so an unclamped build
// reaches 103.7 within the measured second while a clamped one stops at exactly
// 100. One segment cannot merge and no projectile exists, so nothing extracts and
// the crowd holds for the whole second.
//
// WHAT IS ASSERTED. The bound alone, and on every tick of the second rather than
// only at its end, because the requirement is that pressure never rises above 100
// rather than that it arrives anywhere in particular. How fast it climbs is
// `pressure/rise`'s point, and folding that in here would fail a build twice for
// one defect.
//
// THE TOLERANCE. None, and deliberately so: a clamp is exact arithmetic on the
// value the build already holds, not an integration, so a conformant build
// reports at most exactly 100 on every tick. The standing pressure tolerance
// exists for a figure a build integrates toward; there is nothing to integrate in
// `min(100, x)`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { PRESSURE_MAX, type ChargeId } from "../constants";
import {
  captureStill,
  coreCount,
  createHarness,
  poseHall,
  spacedBlock,
  type Harness,
} from "../harness";

/** Cores on the channel: 76 above `PRESSURE_FREE`, so a rise of 3.8 per second. */
const CORES = 100;

/**
 * The head of the posed block.
 *
 * 100 cores spaced by 28 span 2772 units, so the block sits wholly inside the
 * channel with its tail at 228 and its head far short of the intake at 5000 even
 * at the doubled feed a pressure of 100 brings.
 */
const HEAD_S = 3000;

/** One second of simulation: enough for an unclamped build to overshoot by 3.7. */
const TICKS = 60;

/** The charge every posed core carries. Uniform, so no run can be completed. */
const CHARGE: ChargeId = "sulfur";

/** A pressure a tenth short of the ceiling, so the very first tick meets it. */
const START_PRESSURE = 99.9;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("never reports a pressure above 100 under a rise that would overshoot", async () => {
  await poseHall(harness, {
    level: 1,
    quotaRemaining: 0,
    pressure: START_PRESSURE,
    cores: spacedBlock(HEAD_S, CORES, CHARGE),
  });

  const history = await harness.stepWatching(TICKS);

  // The gauge as the frame that ran last left it, which is the picture of the
  // HUD at the ceiling this point is about. Captured before the assertions, so a
  // failing build leaves the evidence that shows why.
  await captureStill(harness, "gauge");

  assertEqual(
    coreCount(history[history.length - 1]),
    CORES,
    "the posed cores still on the channel after the measured second",
  );
  for (const [index, snapshot] of history.entries()) {
    assertLessThanOrEqual(
      snapshot.pressure,
      PRESSURE_MAX,
      `pressure on tick ${index + 1} of ${TICKS}`,
    );
  }
});
