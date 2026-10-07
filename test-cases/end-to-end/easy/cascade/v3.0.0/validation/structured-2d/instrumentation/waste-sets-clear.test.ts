// instrumentation/waste-sets-clear — `clearWasteSets` empties the set memory and
// leaves the cards on the waste standing.
//
// THE RULE. `specs/instrumentation.md`, The waste's sets: `clearWasteSets()`
// "Empties the waste's set memory, leaving the cards on the waste standing."
//
// BOTH HALVES ARE READ, because they fail differently and one of them is the
// whole reason the operation is separate from `clearPile`: a build whose
// `clearWasteSets` also swept the pile passes on the memory and takes six cards
// off the table with it, which every scenario that poses a waste would then be
// posing wrong.
//
// THE MEMORY IS FILLED FIRST, so what is read is an EMPTYING rather than a memory
// that was never written: a build whose operation does nothing at all reads back
// the two sets it was left holding.
//
// THREE OPERATIONS ON THE MEMORY, THREE POINTS.
// `instrumentation/waste-set-appends` grades the append and
// `instrumentation/waste-visible-count-follows-newest` the derived count.
//
// WHAT THIS DOES NOT DECIDE. What playing a card off the waste takes away, which
// is `stock/set-shrinks-on-play`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FIVE,
  FOUR,
  openTable,
  poseWaste,
  SEVEN,
  SIX,
  THREE,
  TWO,
  up,
  type Harness,
} from "../harness";

/** The cards laid on the waste, bottom card first. */
const WASTE = [
  up(card("clubs", TWO)),
  up(card("diamonds", THREE)),
  up(card("spades", FOUR)),
  up(card("hearts", FIVE)),
  up(card("diamonds", SIX)),
  up(card("clubs", SEVEN)),
] as const;

/** The memory the clear is made against, oldest first. */
const SETS = [2, 3] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the memory and leaves the cards where they were", async () => {
  openTable(h);
  await poseWaste(h, [...WASTE], [...SETS]);

  const filled = h.snapshot();
  h.debug.clearWasteSets();
  // Read before a frame runs: nothing stands between the call and the reading.
  const cleared = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a clear that swept the pile still leaves the
  // picture of the waste it emptied.
  captureStill(h, "waste");

  assertLength(
    filled.wasteSets,
    SETS.length,
    "posing: the sets on the memory before the clear — a memory that was " +
      "never written leaves the clear nothing to empty",
  );
  assertLength(
    cleared.wasteSets,
    0,
    "the waste's set memory after clearWasteSets() (specs/instrumentation.md)",
  );
  assertLength(
    cleared.waste,
    WASTE.length,
    "the cards still on the waste after clearWasteSets(), which leaves them " +
      "standing (specs/instrumentation.md)",
  );
});
