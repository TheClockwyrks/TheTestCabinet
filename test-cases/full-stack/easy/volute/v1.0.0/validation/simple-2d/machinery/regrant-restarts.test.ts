// machinery/regrant-restarts — granting the kind that is ALREADY running starts
// its duration afresh.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("The active machinery"): "A grant of
// any of the three becomes the active machinery, replacing whatever was active
// and starting its full duration afresh, including a grant of the kind already
// active." `specs/instrumentation.md` (`grantMachinery`) says the same of the
// operation this drive poses through: a grant makes the kind active "at its full
// duration, replacing whatever was active and restarting its timer".
//
// WHY IT IS A POINT OF ITS OWN. `machinery/single-active` decides the OTHER half
// of that sentence — that a grant replaces a DIFFERENT kind that was running. The
// two are independently implementable: a build that keys its grant off the kind
// and skips the write when the kind is unchanged replaces correctly and refuses
// to restart, and a build that always writes does both. One point cannot tell
// those apart, so the re-grant is graded here.
//
// HOW THE READING RULES OUT A TIMER THAT NEVER MOVED. Three readings of the same
// machinery: at the grant, after a second of play, and at the re-grant. The
// middle one has to be BELOW the full duration by more than the tolerance, which
// is what says the timer was really running down; the last one has to be back at
// the full duration. A build that ignores the re-grant fails the last reading,
// and a build whose timer never falls at all fails the middle one.
//
// THE TOLERANCE. The duration is read with no tick stepped since the grant, so an
// ideal build reports exactly 12 s and the case's standing duration tolerance of
// 2 ticks (0.033 s) is slack for a build that has already taken this tick's
// decrement off it. A second of play is 30 times that slack, so the middle
// reading is never a near miss.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan, assertNear } from "../assert";
import { MACHINERY_DURATION, TICK_DT, TICK_HZ, TICK_TOL } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  type Harness,
} from "../harness";

/** The level the drive opens on. Nothing here reads a level figure. */
const LEVEL = 1;

/** Where the lone core is posed, so the hall has something standing in it. */
const CORE_S = 1000;

/** The kind granted, and then granted again over itself. */
const KIND = "sightline";

/** A second of play between each grant, so a running timer visibly falls. */
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

it(`starts ${KIND} afresh when it is granted over the ${KIND} already running`, async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: [[CORE_S, "halide", null]],
    machinery: KIND,
  });

  // A second of play, so the machinery in force is one the ticks have worn down
  // rather than one that was never running.
  await h.step(HELD_TICKS);
  const worn = await h.snapshot();

  await h.debug.grantMachinery(KIND);
  const regranted = await h.snapshot();
  await captureStill(h, "regranted");

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
