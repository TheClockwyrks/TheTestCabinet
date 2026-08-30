// stock/recycle-clears-waste — a recycle leaves the waste empty.
//
// THE RULE. specs/stock.md: after a recycle "the waste is left empty and its set
// memory is emptied with it". The cards went to the stock, so a waste that still
// held any of them would mean the deck had grown: the same card would be waiting on
// two piles at once, and the pass that followed would deal a duplicate onto the
// waste it was already on.
//
// THE WASTE IS POSED WITH SEVERAL CARDS UNDER SEVERAL SETS, so a build that took
// only the shown set back, or only the top card, leaves cards behind and is caught
// by a count rather than by an empty pile that was already empty.
//
// THE SET MEMORY IS THE OTHER HALF of that sentence and it is
// `stock/recycle-clears-sets`, kept apart so a build that emptied the cards and left
// the counts standing fails one point and names which half it got wrong. That the
// cards ARRIVED on the stock is `stock/empty-stock-recycles`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  poseWaste,
  type Harness,
} from "../harness";

/** The waste the recycle empties: three cards under two sets. */
const POSED_WASTE = ["2C", "9D", "4S"] as const;
const POSED_SETS = [1, 2] as const;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves no card on the waste once it has been recycled", async () => {
  openTable(harness);
  poseWaste(harness, POSED_WASTE, POSED_SETS);
  harness.debug.turnStock();

  await harness.advance(1);
  captureStill(harness, "recycled");

  assertLength(
    harness.snapshot().waste,
    0,
    "cards left on the waste after a turn of an empty stock recycled it " +
      "(specs/stock.md)",
  );
});
