// machinery/bore-takes-no-slot — a bore leaves the machinery already running
// untouched, with its own clock still going.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("The active machinery"): "`bore`
// never becomes the active machinery and leaves the active machinery and its
// remaining time untouched." That is a separate requirement from the radius a
// bore clears (`machinery/bore-radius`): a build with a correct radius whose bore
// evicts the running choke is a different build from one that gets the radius
// wrong too, and one point cannot tell them apart.
//
// WHAT IS READ. A choke is granted before the first tick and read back on the
// tick the bore resolves. A build whose bore takes the active slot reports `bore`
// there, or reports nothing; a build whose bore restarts or disturbs the timer
// reports the wrong remaining.
//
// THE CHOKE DOES NOT MOVE THE DRIVE. `specs/machinery.md` ("Choke"): it
// multiplies the feed speed alone and "catch-up, recoil, merging, emission, and
// the rise and bleed of pressure all hold at the rates they otherwise take", so
// the trailing core still closes at 180 units/s and the merge still happens. How
// far the choke slows the lead segment is `machinery/choke-multiplier`'s point
// and nothing here reads it.
//
// HOW THE BORE IS REACHED is in `machinery/bore.ts`, which both bore points
// share: a run carrying a `bore` mark, extracted by a merge the build's own
// advance closes.
//
// THE TOLERANCE. The kind is an equality, not a measurement. The remaining time
// is read against the case's standing +/- 2 ticks on a duration, measured from
// the full 8 s the grant started at less the ticks the drive ran — so a build
// that restarted the timer misses by the whole drive and a build that cleared it
// reports nothing at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, assertNotNull } from "../assert";
import { MACHINERY_DURATION, TICK_DT, TICK_TOL } from "../constants";
import { createHarness, captureReplay, type Harness } from "../harness";
import { TRAILING_TICKS, driveBore, poseBoreHall } from "./bore";

/** The timed machinery left running across the bore, and its stated duration. */
const STANDING = "choke";
const STANDING_DURATION = MACHINERY_DURATION[STANDING];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves the ${STANDING} running across a bore, with its own clock still going`, async () => {
  await poseBoreHall(h, { standing: STANDING });

  const granted = h.snapshot();
  assertEqual(
    granted.machinery?.kind ?? null,
    STANDING,
    `the machinery running before the bore resolves`,
  );

  const swept = await captureReplay(h, "standing", async () => {
    const resolved = await driveBore(h);
    await h.step(TRAILING_TICKS);
    return resolved;
  });

  assertNotNull(
    swept.snapshot.machinery,
    `the active machinery on the tick the bore resolved, with a ${STANDING} running across it`,
  );
  assertEqual(
    swept.snapshot.machinery?.kind,
    STANDING,
    "the kind left active by a bore, which becomes no active machinery",
  );
  assertNear(
    swept.snapshot.machinery?.remaining ?? Number.NaN,
    STANDING_DURATION - swept.ticks * TICK_DT,
    TICK_TOL * TICK_DT,
    `the seconds left on the ${STANDING} the bore was asked to leave untouched`,
  );
});
