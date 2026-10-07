// machinery/bore-takes-no-slot — a bore leaves the timed machinery already
// running exactly as it found it.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("The active machinery"): "`bore`
// never becomes the active machinery and leaves the active machinery and its
// remaining time untouched." `specs/machinery.md` ("Bore") says the same from the
// other side: a bore "takes effect on the tick it is granted and occupies no
// time".
//
// WHY IT IS A POINT OF ITS OWN. `machinery/bore-radius` decides what a bore
// REMOVES. This decides what it leaves standing in the active slot, which a build
// implements separately: a build whose grant path writes every kind into the
// active machinery removes exactly the right cores and still evicts the choke it
// resolved beside. One point cannot tell those two apart, so a bore's radius and
// a bore's slot are graded separately.
//
// HOW THE BORE IS REACHED. By an extraction, because that is the only thing that
// grants one: `specs/machinery.md` ("Granting") makes extraction "the only source
// of a grant", and `specs/instrumentation.md` (`grantMachinery`) grants the three
// timed kinds alone. So the drive poses a lead segment whose tail carries a
// `bore` mark and a single core of the run's charge one channel spacing plus a
// gap behind it; the trailing core closes at the fixed catch-up rate, the merge
// completes a run of three, and `specs/channel.md` ("The order of a tick", step
// 4) resolves the bore the removal granted.
//
// WHAT IS READ. The active machinery on the tick the bore resolved. A choke is
// granted before the first tick, so what a conformant build reports there is a
// `choke` whose remaining is its full 8 s less the seconds the drive ran — the
// ticks the harness stepped, counted rather than assumed. A build whose bore
// takes the slot reports `bore` or nothing; a build whose bore restarts the timer
// reports the full 8 s; a build whose bore clears it reports null.
//
// THAT THE BORE REALLY RESOLVED is asserted too, from the cores: the removal takes
// the three of the run and the bore takes the cores within `BORE_RADIUS` of the
// extraction point, so a hall that lost only the run's three never exercised the
// rule this point is about and the reading would be vacuous.
//
// THE CHOKE DOES NOT MOVE THE ARRANGEMENT. `specs/machinery.md` ("Choke"): it
// multiplies the feed speed alone and "catch-up, recoil, merging, emission, and
// the rise and bleed of pressure all hold at the rates they otherwise take", so
// the trailing core still closes at 180 units/s and the merge still happens.
//
// THE TOLERANCE. The kind is an equality. The remaining time is read against the
// case's standing +/- 2 ticks on a duration, over a count of ticks the harness
// took rather than a predicted one.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertNear,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  MACHINERY_DURATION,
  MIN_RUN,
  SPACING,
  TICK_DT,
  TICK_TOL,
  type ChargeId,
} from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  type Harness,
  type PosedCore,
} from "../harness";

/** The level the hall opens on; nothing here reads a level figure. */
const LEVEL = 1;

/** The charge the extracted run is made of. */
const RUN_CHARGE: ChargeId = "halide";

/** The arc position of the marked core: the tail of the lead segment. */
const MARKED_S = 824;

/**
 * The lead segment, head first and one channel spacing apart.
 *
 * The two behind carry the run's charge; the three ahead of them alternate two
 * others, so the maximal same-charge run spanning the join is exactly three long
 * and the cores the bore reaches are ones this check does not read.
 */
const LEAD: PosedCore[] = [
  [MARKED_S + SPACING * 4, "cobalt", null],
  [MARKED_S + SPACING * 3, "sulfur", null],
  [MARKED_S + SPACING * 2, "cobalt", null],
  [MARKED_S + SPACING, RUN_CHARGE, null],
  [MARKED_S, RUN_CHARGE, "bore"],
];

/** How far behind the merge position the closing core starts. */
const CLOSING_GAP = 60;

/** The core that closes the gap and completes the run. */
const CLOSER_S = MARKED_S - SPACING - CLOSING_GAP;

const CORES: PosedCore[] = [...LEAD, [CLOSER_S, RUN_CHARGE, null]];

/**
 * How long the drive waits for the merge, in ticks.
 *
 * `specs/channel.md` fixes the closing rate — 180 units/s behind a lead segment
 * riding the level's 22 taken to 8.8 by the choke — so the gap closes in
 * 60 / (180 - 8.8) seconds, 21.0 ticks. The cap is nearly three times that, so a
 * build whose catch-up is slow rather than absent still reaches the merge.
 */
const MERGE_MAX_TICKS = 60;

/** Ticks recorded after the bore resolves, so the replay shows what it left. */
const TRAILING_TICKS = 40;

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

it(`leaves the ${STANDING} already running active, with its clock still going, when a bore resolves`, async () => {
  await poseHall(h, {
    level: LEVEL,
    pressure: 0,
    cores: CORES,
    // Running before the bore is granted, so what the bore does to it is
    // readable on the tick the bore resolves.
    machinery: STANDING,
  });

  const swept = await captureReplay(h, "standing", async () => {
    const merged = await h.stepUntil((s) => coreCount(s) < CORES.length, {
      maxTicks: MERGE_MAX_TICKS,
      poll: 1,
    });
    await h.step(TRAILING_TICKS);
    return merged;
  });
  assertTrue(
    swept.hit,
    `the run holding the bore mark was extracted within ${MERGE_MAX_TICKS} ticks`,
  );

  // The bore really resolved: the extraction alone takes the run's three cores,
  // so a hall standing more than that lost cores to the bore as well.
  assertLessThan(
    coreCount(swept.snapshot),
    CORES.length - MIN_RUN,
    "the cores left once the extraction AND the bore it granted had resolved",
  );

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
