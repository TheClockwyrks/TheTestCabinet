// machinery/regrant-restarts — granting the kind already running starts its
// duration afresh.
//
// THE SPEC LINE. `specs/machinery.md` — "The active machinery": a grant "becomes
// the active machinery, replacing whatever was active and starting its full
// duration afresh, including a grant of the kind already active."
// `specs/instrumentation.md` says the same of `grantMachinery`: the three timed
// kinds "become the active machinery at their full duration, replacing whatever
// was active and restarting its timer."
//
// WHY IT IS A POINT OF ITS OWN. `machinery/single-active` decides what a grant
// does to a DIFFERENT kind: it replaces it. This decides what a grant does to the
// SAME kind, and the two are independently implementable — a build that keys its
// grant off "is the active kind different?" replaces correctly and treats a
// second grant of the running kind as a no-op, which is a real defect the player
// feels as machinery that runs out early, and one point cannot tell the two
// apart.
//
// THE DRIVE. Grant, run a second of play, read what is left, grant the same kind
// again, read again. The reading BEFORE the second grant is what stops the point
// passing on a timer that never moved: a machinery a second of play has worn down
// reports under its full duration by far more than the tolerance, and the grant
// that follows has to put it back.
//
// WHY SIGHTLINE. It is the kind that leaves the feed, the advance and the inlet
// alone (`specs/machinery.md` — "Sightline"), so nothing about the hall changes
// under it and the reading is the timer and nothing else.
//
// THE HALL. Empty, with the inlet held and the train held: this point is about a
// timer, so nothing on the channel is part of it.
//
// THE TOLERANCES. The kind is an equality. The duration is read with no tick
// stepped since the grant, so an ideal build reports exactly 12 s and the case's
// standing duration tolerance of 2 ticks (0.033 s) is slack for a build that has
// already taken this tick's decrement off it. The worn reading is asserted
// strictly below the full duration less that same tolerance, so the two readings
// cannot both be satisfied by a timer that never ran.

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

/** The kind granted, and granted again over itself. */
const KIND = "sightline";

/** The duration `specs/machinery.md` gives it. */
const DURATION = MACHINERY_DURATION[KIND];

/** A second of play between the two grants, so the timer visibly runs down. */
const WORN_TICKS = TICK_HZ;

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
  await poseHall(h, { feed: false, machinery: KIND });
  await h.step(WORN_TICKS);
  const worn = await h.snapshot();

  await h.debug.grantMachinery(KIND);
  const regranted = await h.snapshot();
  await captureStill(h, "regranted");

  assertNotNull(worn.machinery, `the ${KIND} running before the second grant`);
  assertLessThan(
    worn.machinery?.remaining ?? Number.NaN,
    DURATION - DURATION_TOL,
    `the seconds left on the ${KIND} after a second of play, before it is ` +
      "granted again",
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
