// machinery/bore-grants-nothing — a marked core a bore removes grants nothing.
//
// WHAT THE SPEC FIXES. `specs/machinery.md` ("Granting"): "Extraction is the only
// source of a grant, and a marked core a bore removes grants nothing."
//
// WHY IT IS A POINT OF ITS OWN. Every other grant point reads what an EXTRACTION
// pays. This reads the one removal that pays no grant at all, which a build
// implements separately: a build whose removal path grants the marks of whatever
// it took, without asking which removal it was, gets every extraction right and
// this wrong. Nothing else in the suite would catch it.
//
// THE SCENARIO. A lead segment whose tail carries a `bore` mark, with a single
// core of the run's charge posed one channel spacing plus a gap behind it. The
// trailing core closes at the fixed catch-up rate `specs/channel.md` gives every
// non-lead segment, the merge completes a same-charge run of three, and
// `specs/extraction.md` ("Extraction on a merge") extracts it. `specs/channel.md`
// ("The order of a tick", step 4) then resolves the bore that removal granted.
//
// WHERE THE SECOND MARK STANDS. Two channel spacings ahead of the marked core, on
// the same leg, so it is 56 units from the extraction point — inside the
// `BORE_RADIUS` of 90 `specs/machinery.md` fixes, with 34 units to spare, and the
// margin only widens as the lead segment rides. It carries a different charge
// from the run, so `specs/extraction.md`'s maximal same-charge run stops before
// it and the EXTRACTION cannot take it: the only removal that reaches it is the
// bore.
//
// WHAT IS READ. Two things, both halves of one requirement: the marked core is
// gone — so the bore really removed a marked core — and no timed machinery is in
// force. A build that grants what a bore removes reports `sightline` standing; a
// build that follows the rule reports nothing at all, because the `bore` mark the
// EXTRACTION took grants a bore and a bore "never becomes the active machinery".
//
// THE TOLERANCE. None: the reading is a presence and a count. A core is matched
// to its posed arc position within the case's standing arc tolerance of 0.5
// units, over an advance measured off the surviving head rather than assumed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import { ARC_TOL, BORE_RADIUS, SPACING, type ChargeId } from "../constants";
import {
  arcPositions,
  captureReplay,
  channelPoint,
  coreCount,
  createHarness,
  distance,
  poseHall,
  type Harness,
  type PosedCore,
} from "../harness";

/** The level the hall opens on; the bore's radius is the same on every level. */
const LEVEL = 1;

/** The charge the extracted run is made of. */
const RUN_CHARGE: ChargeId = "halide";

/** The kind the core inside the blast carries, which the bore must not grant. */
const CAUGHT_MARK = "sightline";

/** The arc position of the bore-marked core: the tail of the lead segment. */
const MARKED_S = 824;

/** The marked core the BORE removes, two spacings ahead and 56 units away. */
const CAUGHT_S = MARKED_S + SPACING * 2;

/** The head of the lead segment, far outside the radius, whose advance is read back. */
const HEAD_S = MARKED_S + SPACING * 5;

/**
 * The lead segment, head first and one channel spacing apart.
 *
 * The two behind carry the run's charge; the three ahead of them carry others, so
 * the maximal same-charge run spanning the join is exactly three long and the
 * marked core at {@link CAUGHT_S} is outside it.
 */
const LEAD: PosedCore[] = [
  [HEAD_S, "cobalt", null],
  [MARKED_S + SPACING * 4, "sulfur", null],
  [MARKED_S + SPACING * 3, "cobalt", null],
  [CAUGHT_S, "sulfur", CAUGHT_MARK],
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
 * riding the level's 22 — so the gap closes in 60 / (180 - 22) seconds, 22.8
 * ticks. The cap is over twice that, so a build whose catch-up is slow rather
 * than absent still reaches the merge.
 */
const MERGE_MAX_TICKS = 60;

/** Ticks recorded after the bore resolves, so the replay shows what it left. */
const TRAILING_TICKS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`grants nothing for the ${CAUGHT_MARK}-marked core a bore removes`, async () => {
  await poseHall(h, { level: LEVEL, pressure: 0, cores: CORES });

  const swept = await captureReplay(h, "bored", async () => {
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

  // The whole lead segment rode the same arc while the drive ran, and its head is
  // far outside the radius, so what the head gained is what every core gained.
  const standing = arcPositions(swept.snapshot);
  const advance = Math.max(...standing) - HEAD_S;

  // The marked core really stood inside the blast, and the bore really took it.
  const extraction = channelPoint(MARKED_S + advance);
  const caughtAt = MARKED_S + SPACING * 2 + advance;
  assertTrue(
    distance(channelPoint(caughtAt), extraction) < BORE_RADIUS,
    `the ${CAUGHT_MARK}-marked core stands inside the bore's ${BORE_RADIUS}-unit radius`,
  );
  assertEqual(
    standing.some((s) => Math.abs(s - caughtAt) <= ARC_TOL),
    false,
    `whether the ${CAUGHT_MARK}-marked core the bore reached is still on the channel`,
  );

  assertNull(
    swept.snapshot.machinery,
    `the active machinery after a bore removed a ${CAUGHT_MARK}-marked core, ` +
      "which grants nothing",
  );
});
