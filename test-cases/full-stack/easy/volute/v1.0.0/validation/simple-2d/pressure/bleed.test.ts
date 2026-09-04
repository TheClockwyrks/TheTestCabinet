// pressure/bleed — pressure bleeds off an uncrowded channel.
//
// WHAT THE SPEC FIXES. `specs/channel.md` ("Pressure") states the bleed exactly:
//
//   rise  = max(0, coreCount - 24) x 0.05
//   bleed = 2.0 when coreCount <= 24, otherwise 0
//   pressure = clamp(pressure + (rise - bleed) x dt, 0, 100)
//
// with "Bleed per second while the channel is not over `PRESSURE_FREE` | `2.0`".
// A channel carrying exactly 24 cores is not over `PRESSURE_FREE` (`24`), so it
// bleeds at the full 2.0 per second and rises by `max(0, 24 - 24) x 0.05` = 0.
// One second therefore carries a pressure of 50 to exactly 48.
//
// 24 IS THE BOUNDARY, and it is posed deliberately: the spec's two branches meet
// there and both name it as bleeding, so a build that wrote `coreCount < 24` for
// the bleed fails here while a build that wrote the stated `<=` passes.
//
// THE DRIVE. An isolated hall: the inlet is held so it delivers nothing that
// would carry the count past 24 mid-measurement, and the channel
// holds exactly 24 cores in one segment. One segment cannot merge and no
// projectile exists, so `specs/extraction.md` has nothing to extract and no
// removal can pay its own drop into the reading. The block is posed clear of the
// intake at s = 5000.
//
// THE TOLERANCE. The case's standing pressure tolerance, +/- 0.05
// (test-case.toml — "STANDING TOLERANCES"). A tick is exactly 1/60 s, so 60 ticks
// of a 2.0 per second bleed is exactly 2.0 however a build orders its tick; the
// band is one and a half ticks' worth of bleed, and the nearest wrong rule — no
// bleed at 24 cores, or a bleed the build scales by the core count — is a whole
// unit or more away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import {
  PRESSURE_BLEED,
  PRESSURE_FREE,
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

/** Cores on the channel: exactly `PRESSURE_FREE`, the boundary the spec bleeds at. */
const CORES = PRESSURE_FREE;

/**
 * The head of the posed block.
 *
 * 24 cores spaced by 28 span 644 units, so the block sits wholly inside the
 * channel with its tail at 1356 and its head far short of the intake at 5000 even
 * after a second of feed.
 */
const HEAD_S = 2000;

/** One second of simulation, which is the span the bleed is stated over. */
const TICKS = 60;

/** The charge every posed core carries. Uniform, so no run can be completed. */
const CHARGE: ChargeId = "cobalt";

/** A pressure with room to fall a full second's bleed without meeting the clamp at 0. */
const START_PRESSURE = 50;

/** `2.0` per second of bleed over `TICKS` ticks, with no rise at 24 cores. */
const EXPECTED = START_PRESSURE - PRESSURE_BLEED * seconds(TICKS);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("falls by 2.0 per second with 24 cores on the channel", async () => {
  await poseHall(harness, {
    level: 1,
    pressure: START_PRESSURE,
    cores: spacedBlock(HEAD_S, CORES, CHARGE),
  });

  const after = await captureReplay(harness, "bleed", () =>
    harness.step(TICKS),
  );

  // The scenario the figure rests on: the channel the bleed was computed for is
  // the channel that stood there for the whole second.
  assertEqual(
    coreCount(after),
    CORES,
    "the posed cores still on the channel after the measured second",
  );
  assertNear(after.pressure, EXPECTED, PRESSURE_TOL, "pressure after 1 s");
});
