// machinery/regrant-restarts — granting the kind already running starts its
// duration afresh.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("The active machinery"): a grant
// "becomes the active machinery, replacing whatever was active and starting its
// full duration afresh, **including a grant of the kind already active**".
// `specs/instrumentation.md` (`grantMachinery`) repeats it of the operation this
// drive poses through.
//
// WHY IT IS ITS OWN POINT. That a grant REPLACES a different kind is
// `machinery/single-active`'s requirement. This is the other half of the same
// sentence and a build implements it separately: treating a re-grant of the
// running kind as a no-op, because "it is already active", is a distinct defect
// from stacking two kinds, and one point cannot tell the two apart.
//
// THE READING BEFORE THE GRANT IS TAKEN TOO, so the check cannot pass on a timer
// that never moved: a machinery a second of play has worn down reports under its
// full duration by more than the tolerance, and the grant that follows puts it
// back.
//
// THE KIND is `sightline`, the one timed kind that leaves the feed speed alone
// (`specs/machinery.md`), so nothing about the hall moves while the drive runs
// and the two readings differ by the grant alone.
//
// THE TOLERANCES. The kind is an equality, not a measurement. The duration is
// read with no tick stepped since the grant, so an ideal build reports exactly
// 12 s and the case's standing duration tolerance of 2 ticks (0.033 s) is slack
// for a build that has already taken this tick's decrement off it. The worn
// reading is asserted below `SECOND_DURATION - DURATION_TOL`, which a second of
// play clears thirty times over.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertNear,
  assertNotNull,
} from "../assert";
import { MACHINERY_DURATION, TICK_DT, TICK_HZ, TICK_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** The level the drive opens on. */
const LEVEL = 1;

/** Where the lone core is posed, so the hall holds something while play runs. */
const CORE_S = 1000;

/** The kind granted twice. */
const KIND = "sightline";

/** Ticks of the first grant run off before the second is made. */
const HELD_TICKS = TICK_HZ;

/** The duration `specs/machinery.md` gives the kind the drive grants twice. */
const DURATION = MACHINERY_DURATION[KIND];

/** The +/- 2 ticks the case's standing tolerances put on a duration, in seconds. */
const DURATION_TOL = TICK_TOL * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`starts a ${KIND} afresh when it is granted over the ${KIND} already running`, async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [[CORE_S, "halide", null]],
    machinery: KIND,
  });
  await h.step(HELD_TICKS);

  const worn = h.snapshot();
  h.debug.grantMachinery(KIND);
  const regranted = h.snapshot();
  captureStill(h, "regranted");

  assertNotNull(
    worn.machinery,
    `the ${KIND} running a second after it was granted`,
  );
  assertLessThan(
    worn.machinery?.remaining ?? Number.NaN,
    DURATION - DURATION_TOL,
    `the seconds left on the ${KIND} after a second of play, before it is granted again`,
  );

  assertEqual(
    regranted.machinery?.kind,
    KIND,
    `the kind left active by a ${KIND} granted over a running ${KIND}`,
  );
  assertNear(
    regranted.machinery?.remaining ?? Number.NaN,
    DURATION,
    DURATION_TOL,
    `the seconds left on a ${KIND} granted over the ${KIND} already active`,
  );
});
