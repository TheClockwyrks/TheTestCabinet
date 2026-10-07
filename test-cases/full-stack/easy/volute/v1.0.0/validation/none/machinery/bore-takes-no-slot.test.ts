// machinery/bore-takes-no-slot — a bore leaves the machinery already running
// untouched, with its clock still going.
//
// THE SPEC LINE. `specs/machinery.md` — "The active machinery": "`bore` never
// becomes the active machinery and leaves the active machinery and its remaining
// time untouched."
//
// WHY IT IS A POINT. `machinery/bore-radius` decides which cores a bore takes.
// This decides what a bore does to the slot the three timed kinds share, which is
// a separate thing a build gets right or wrong: one whose bore evicts the running
// choke, one whose bore takes the slot itself, and one whose bore restarts the
// choke's timer are three distinct defects, and a build with a correct radius can
// carry any of them.
//
// THE POSE. A choke is granted before the drive and the bore is reached by
// extracting a run that carries a `bore` mark — the only way a bore is reached,
// since `grantMachinery` takes the three timed kinds alone
// (`specs/instrumentation.md`). The extraction is the square insertion
// `machinery/insertion-stage` stages, with the train held so nothing about the
// feed enters the reading.
//
// WHY THE CHOKE. It is the kind whose effect is on the feed
// (`specs/machinery.md` — "Choke"), and the feed is held here, so the grant
// changes nothing at all about the scenario the bore resolves in. What the choke
// is WORTH is `machinery/choke-multiplier`'s point and how long it lasts is
// `machinery/machinery-expires`'.
//
// THE TOLERANCE. The kind is an equality. The seconds left are read against the
// full duration less the ticks the drive actually ran, at the case's standing
// +/- 2 ticks on a duration — which is far tighter than any way of getting the
// rule wrong: a bore that restarted the timer reports the full 8 s and a bore
// that took the slot reports another kind or none.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { MACHINERY_DURATION, SPACING, TICK_DT, TICK_TOL } from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  type PosedCore,
} from "../harness";
import {
  assertExtracted,
  driveExtraction,
  RUN_CHARGE,
  STRUCK_S,
  TRAILING_TICKS,
} from "./insertion-stage";

/** The timed machinery left running across the bore, and its stated duration. */
const STANDING = "choke";
const STANDING_DURATION = MACHINERY_DURATION[STANDING];

/** The two cores the shot completes into a run of three, one of them bore-marked. */
const CORES: PosedCore[] = [
  [STRUCK_S, RUN_CHARGE, "bore"],
  [STRUCK_S - SPACING, RUN_CHARGE, null],
];

/** The cores the extraction removes: the two posed plus the seated one. */
const REMOVED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves the running ${STANDING} in force with its clock still going`, async () => {
  let ticks = 0;
  const after = await captureReplay(h, "standing", async () => {
    const resolved = await driveExtraction(h, CORES, { machinery: STANDING });
    // Every tick the drive ran since the grant, which is what the machinery's
    // remaining time must have fallen by and nothing more.
    ticks = Math.round(resolved.simTime / TICK_DT);
    await h.step(TRAILING_TICKS);
    return resolved;
  });

  assertExtracted(after, CORES.length, REMOVED);
  assertNotNull(
    after.machinery,
    `the active machinery on the tick the bore resolved, with a ${STANDING} ` +
      "running across it",
  );
  assertEqual(
    after.machinery?.kind,
    STANDING,
    "the kind left active by a bore, which becomes no active machinery",
  );
  assertNear(
    after.machinery?.remaining ?? Number.NaN,
    STANDING_DURATION - ticks * TICK_DT,
    TICK_TOL * TICK_DT,
    `the seconds left on the ${STANDING} the bore was asked to leave untouched`,
  );
});
