// instrumentation/clear-pile-clears-the-set — `clearPile` on the waste empties
// its set memory as well as its cards, and leaves the other twelve piles
// standing.
//
// THE RULE. specs/instrumentation.md: "`clearPile` leaves the other twelve
// piles standing. On the waste it also empties the waste's set memory."
//
// WHY IT IS ITS OWN POINT. specs/stock.md makes the memory what decides which
// cards the waste shows — "The waste shows the cards it holds from the newest set
// that still holds any" — so a waste left holding cards with its memory intact
// shows cards that are gone. A build can get the column case right
// (`instrumentation/clear-pile`) and this one wrong, and it is graded here or
// nowhere: no other point calls `clearPile` on the waste, and
// `stock/recycle-clears-sets` decides the recycle, which is a different
// operation.
//
// SO THE BOARD IS FULL BEFORE THE CLEAR. All thirteen piles carry cards and the
// waste carries two sets, every card on the board is a different card, and each
// pile is printed — ids, suits, ranks and faces — before and after. The
// comparison is per pile, so a failure names the pile that emptied rather than
// reporting that "the board" changed.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  type Harness,
} from "../harness";
import { assertOtherPilesUnchanged, poseFullBoard, WASTE_SETS } from "./board";

/** The waste, emptied by the second, together with the sets it remembers. */
const WASTE = { pile: "waste", index: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the waste's set memory with the waste", async () => {
  openTable(h);
  poseFullBoard(h);

  const before = h.snapshot();
  assertLength(
    before.wasteSets,
    WASTE_SETS.length,
    "the waste's set memory before the clear",
  );

  h.debug.clearPile(WASTE.pile, WASTE.index);
  const after = h.snapshot();

  await h.advance(1);
  // Before the assertions, so a clear that left cards or sets behind still
  // leaves the picture of the board it left.
  captureStill(h, "board");

  assertLength(
    pileOf(after, WASTE.pile, WASTE.index),
    0,
    "the waste, the pile clearPile named (specs/instrumentation.md)",
  );
  assertLength(
    after.wasteSets,
    0,
    "the waste's set memory: clearing the waste empties it with the cards " +
      "(specs/instrumentation.md)",
  );
  assertOtherPilesUnchanged(
    before,
    after,
    WASTE,
    "clearPile leaves the other twelve piles standing " +
      "(specs/instrumentation.md)",
  );
});
