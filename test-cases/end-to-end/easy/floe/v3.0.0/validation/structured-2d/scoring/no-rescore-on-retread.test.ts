// scoring/no-rescore-on-retread — a hop onto a row this crossing has already
// reached pays nothing.
//
// specs/scoring.md: "Nothing else scores. A hop that is refused, a hop to a row
// already reached this crossing, and a life lost all add nothing."
// specs/hopping.md fixes why: `bestRow` never moves back down within a crossing,
// so a hop back down and up again reaches no new row.
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
// THE COOLDOWN IS WAITED OUT BETWEEN THE HOPS. An accepted hop sets the cooldown
// to `HOP_COOLDOWN` (specs/hopping.md), so a second held frame inside it is
// swallowed rather than refused, and a swallowed hop pays nothing for a reason
// this point is not about. `restHop` covers it. Those frames are inside the
// measured window rather than outside it, so a build that pays the retread a
// frame or two late still reads a payment here.
//
// THE CROSSING TIMER IS LEFT WHERE A FRESH CROSSING PUTS IT — 30 s, held by the
// timer gate — so a build that pays a time bonus per hop reads 60 or 120 over the
// pair rather than 0, and a build that pays `SCORE_ROW` per accepted hop reads 10
// or 20. Every wrong model reads a different number from zero.
//
// THE STRAIT IS EMPTY. Both rows the pair moves between are solid footing — the
// near shore and the bottom ice row, with no vehicle on it (specs/strait.md,
// specs/ice.md) — so nothing arrives between the two hops and neither of them is
// refused for a reason of the traffic's.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ICE_BOTTOM, ROW_NEAR, START_COL } from "../constants";
import {
  captureReplay,
  createHarness,
  hop,
  restHop,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";

/** The row the arrangement hop reaches, and the row the retread drops back to. */
const REACHED_ROW = ICE_BOTTOM;
const BACK_ROW = ROW_NEAR;

/** What the down-and-up pair pays: nothing. */
const EXPECTED_AWARD = 0;

/** Frames recorded after the pair, for the replay alone. Every reading precedes them. */
const AFTER_FRAMES = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pays nothing for hopping back onto a row already reached", async () => {
  startCrossing(h);

  // The arrangement: one hop up, so row 18 has been reached and row 19 is behind
  // the crossing's best. What it paid is `row-advance`'s point, not this one, so
  // the reading below opens after it.
  await hop(h, "up");
  const reached = h.snapshot();
  assertEqual(reached.critter.row, REACHED_ROW, "the row the crossing reached");
  assertEqual(reached.critter.bestRow, REACHED_ROW, "that row as the best");

  const retread = await captureReplay(h, "score", async () => {
    await restHop(h);
    await hop(h, "down");
    const back = h.snapshot();
    await restHop(h);
    await hop(h, "up");
    const again = h.snapshot();
    await h.advance(AFTER_FRAMES);
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
