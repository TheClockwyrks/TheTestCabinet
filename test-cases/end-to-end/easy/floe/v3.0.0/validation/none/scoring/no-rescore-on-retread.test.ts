// scoring/no-rescore-on-retread — a hop onto a row this crossing has already
// reached pays nothing.
//
// `specs/scoring.md`: "Nothing else scores. A hop that is refused, a hop to a row
// already reached this crossing, and a life lost all add nothing."
// `specs/hopping.md` fixes why: `bestRow` "never moves back down within a
// crossing", so a hop back down and up again reaches no new row.
//
// THE PAIR OF HOPS IS DOWN THEN UP, and both are read as having been ACCEPTED,
// because "scored nothing" is only worth anything of a hop the game took: a build
// that refuses one of them scores nothing either, and would otherwise pass here
// on a defect this point is not about. The scoring reading is taken across the
// two of them together, with the arrangement hop that first reached row 18 —
// which does pay, and is `row-advance`'s business — left outside it.
//
// THE ROW RETURNED TO IS THE ROW JUST LEFT, one tile of travel and no further:
// the shortest retread the strait allows, so nothing between the two readings can
// pay for anything but the retread itself.
//
// THE CROSSING TIMER IS LEFT WHERE A FRESH CROSSING PUTS IT — 30 s, held by the
// timer gate — so a build that pays a time bonus per hop reads 60 or 120 over the
// pair rather than 0, and a build that pays `SCORE_ROW` per accepted hop reads 10
// or 20. Every wrong model reads a different number from zero.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ICE_BOTTOM, ROW_NEAR, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  hop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The row the arrangement hop reaches, and the row the retread drops back to. */
const REACHED_ROW = ICE_BOTTOM;
const BACK_ROW = ROW_NEAR;

/** What the down-and-up pair pays: nothing. */
const EXPECTED_AWARD = 0;

/** Ticks recorded after the pair, for the replay alone. Every reading precedes them. */
const AFTER_TICKS = ticksFor(0.25);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("pays nothing for hopping back onto a row already reached", async () => {
  await startCrossing(harness);

  // The arrangement: one hop up, so row 18 has been reached and row 19 is behind
  // the crossing's best. What it paid is `row-advance`'s point, not this one, so
  // the reading below opens after it.
  await hop(harness, "up");
  const reached = await harness.snapshot();
  assertEqual(reached.critter.row, REACHED_ROW, "the row the crossing reached");
  assertEqual(reached.critter.bestRow, REACHED_ROW, "that row as the best");

  const retread = await captureReplay(harness, "score", async () => {
    await hop(harness, "down");
    const back = await harness.snapshot();
    await hop(harness, "up");
    const again = await harness.snapshot();
    await harness.advance(AFTER_TICKS);
    return { back, again };
  });

  // Both hops have to have been taken: a refused hop scores nothing for a reason
  // this point is not about (`refused-hop-scores-nothing`).
  assertEqual(retread.back.critter.row, BACK_ROW, "the row the down hop took");
  assertEqual(retread.back.critter.col, START_COL, "the column it stayed in");
  assertEqual(
    retread.again.critter.row,
    REACHED_ROW,
    "the row hopped back onto",
  );

  assertEqual(
    retread.again.score - reached.score,
    EXPECTED_AWARD,
    "nothing paid over a hop down and a hop back onto a row already reached",
  );
});
