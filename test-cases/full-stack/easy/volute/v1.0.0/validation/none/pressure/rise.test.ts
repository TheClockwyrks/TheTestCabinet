// pressure/rise — pressure rises with a crowded channel.
//
// WHAT THE SPEC FIXES. `specs/channel.md` ("Pressure") states the rise exactly:
//
//   rise  = max(0, coreCount - 24) x 0.05
//   bleed = 2.0 when coreCount <= 24, otherwise 0
//   pressure = clamp(pressure + (rise - bleed) x dt, 0, 100)
//
// with "Cores the channel carries before pressure rises (`PRESSURE_FREE`) | `24`"
// and "Rise per second for each core above `PRESSURE_FREE` | `0.05`". So a
// channel carrying 44 cores rises at (44 - 24) x 0.05 = 1.0 per second and bleeds
// nothing, and one second of simulation carries a pressure of 0 to exactly 1.0.
//
// THE DRIVE. An isolated hall on level 1, with the inlet held so it delivers
// nothing that would change the count under the measurement
// (`specs/instrumentation.md` — `setEmission(false)` "stops step 7 of the tick
// order ... no core is emitted"), the pressure posed at 0, and the channel holding
// exactly 44 cores in one segment. One segment cannot merge and no projectile
// exists, so `specs/extraction.md` has nothing to extract and the count holds at
// 44 for the whole measured second. The block is posed clear of the intake at
// s = 5000, so nothing arrives there and spends a cell.
//
// THE TOLERANCE. The case's standing pressure tolerance, +/- 0.05
// (test-case.toml — "STANDING TOLERANCES"). A tick is exactly 1/60 s, so 60 ticks
// of a 1.0 per second rise is exactly 1.0 whatever order a build integrates it
// in; the band is three ticks' worth of rise, which absorbs a build that applies
// the tick's rise at a different point of the tick order while still failing one
// that counts the free cores wrongly (24 versus 44 free cores are 1.0 apart) or
// that uses the wrong per-core figure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  PRESSURE_FREE,
  PRESSURE_RISE_PER_CORE,
  PRESSURE_TOL,
  type ChargeId,
} from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  seconds,
  spacedBlock,
  type Harness,
} from "../harness";

/** Cores on the channel: 20 above `PRESSURE_FREE`, so a rise of 1.0 per second. */
const CORES = 44;

/**
 * The head of the posed block.
 *
 * 44 cores spaced by 28 span 1204 units, so the block sits wholly inside the
 * channel with its tail at 796 and its head far short of the intake at 5000 even
 * after a second of feed.
 */
const HEAD_S = 2000;

/** One second of simulation, which is the span the rise is stated over. */
const TICKS = 60;

/** The charge every posed core carries. Uniform, so no run can be completed. */
const CHARGE: ChargeId = "halide";

/** "pressure ... is `0` when a level starts" — the value the rise is measured from. */
const START_PRESSURE = 0;

/** `max(0, coreCount - 24) x 0.05` over `TICKS` ticks, from the pose's 0. */
const EXPECTED =
  START_PRESSURE +
  Math.max(0, CORES - PRESSURE_FREE) * PRESSURE_RISE_PER_CORE * seconds(TICKS);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("rises by 0.05 per second for each core above 24", async () => {
  await poseHall(harness, {
    level: 1,
    pressure: START_PRESSURE,
    cores: spacedBlock(HEAD_S, CORES, CHARGE),
  });

  const after = await captureReplay(harness, "rise", () => harness.step(TICKS));

  // The scenario the figure rests on: the crowd the rise was computed for is the
  // crowd that was on the channel for the whole second.
  assertEqual(
    coreCount(after),
    CORES,
    "the posed cores still on the channel after the measured second",
  );
  assertNear(after.pressure, EXPECTED, PRESSURE_TOL, "pressure after 1 s");
});
