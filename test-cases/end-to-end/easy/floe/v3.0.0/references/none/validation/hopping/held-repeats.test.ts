// hopping/held-repeats — a held direction auto-repeats at the cooldown.
//
// `specs/hopping.md`: "a direction held across the cooldown hops again the moment
// the cooldown reaches `0`, so holding a direction auto-repeats at
// `HOP_COOLDOWN`". One second of game time with a direction held is therefore the
// first hop plus one for every whole cooldown that fits inside the second:
// `floor(1 / HOP_COOLDOWN) + 1`, which is `9`.
//
// WHY ONE HOP OF SLACK IS THE HONEST TOLERANCE, AND NOT MERE ROUNDING. The
// simulation runs at `TICK_HZ` (`120`) ticks a second (`specs/overview.md`), so
// `HOP_COOLDOWN` (`0.12` s) is `14.4` ticks and no build can hop on a fraction of
// one. A build that repeats on the first whole tick at or past the cooldown
// repeats every `15` ticks and fits `8` hops into `120`; one that repeats on the
// last whole tick before it repeats every `14` and fits `9`. Both play the same
// and both are conformant, so the check admits `8` to `10` — and a build that
// does not auto-repeat at all lands `1`, one that repeats every tick lands `120`,
// and one whose cooldown is twice or half the figure lands `4` or `17`. Every
// wrong model reads as a different number, and none of them is inside the band.
//
// THE HOLD RUNS ALONG A ROW, NOT UP THE STRAIT. Nine hops up from the near shore
// would arrive at the far shore and end the crossing partway through the second;
// nine hops rightward along a cleared ice row (`specs/strait.md`) stay on plain
// solid ice from column 20 to at most column 30, well inside the grid, so the
// count is a count of hops and of nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { HOP_COOLDOWN, HOP_KEY, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** A row of the ice band, clear from edge to edge once the strait is emptied. */
const ROW = 15;

/** The seconds of game time the direction is held for. */
const HOLD_SECONDS = 1;

/** The hops that second holds: the first, plus one per whole cooldown inside it. */
const EXPECTED_HOPS = Math.floor(HOLD_SECONDS / HOP_COOLDOWN) + 1;

/**
 * The slack, in hops.
 *
 * One hop: the cadence is `14.4` ticks and a build must round it to whole ticks
 * one way or the other, which moves the count by exactly one.
 */
const HOP_TOLERANCE = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("hops nine tiles for a direction held one second", async () => {
  await startCrossing(harness);
  await harness.debug.addCritter(START_COL, ROW);

  const after = await captureReplay(harness, "hop", async () => {
    await harness.holdFor(HOP_KEY.right, ticksFor(HOLD_SECONDS));
    return harness.snapshot();
  });

  assertBetween(
    after.critter.col - START_COL,
    EXPECTED_HOPS - HOP_TOLERANCE,
    EXPECTED_HOPS + HOP_TOLERANCE,
    `tiles hopped in ${HOLD_SECONDS} s of a held direction`,
  );
  assertEqual(
    after.critter.row,
    ROW,
    "the row, which no rightward hop changed",
  );
});
