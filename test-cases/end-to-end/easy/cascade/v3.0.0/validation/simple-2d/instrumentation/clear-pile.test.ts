// instrumentation/clear-pile — `clearPile` empties the pile it names, and only
// that one.
//
// specs/instrumentation.md: `clearPile(pile, index)` "removes every card from the
// named pile" and "leaves the other twelve piles standing". On the waste "it also
// empties the waste's set memory".
//
// WHY THE SUITE RESTS ON IT. Together with `clearTable` it is what lets a check
// pose one pile at a time instead of handing the build a whole board, which is the
// isolation the case is built on. A build whose `clearPile` reached into its
// neighbours would leave every scenario posed on top of one it never asked for.
//
// TWO CHECKS, because the waste carries a second thing to clear. A build that
// empties a column correctly and leaves the waste's set memory standing has a waste
// that remembers sets holding cards that are no longer there, which
// specs/stock.md's own rules then read: the memory is emptied with the cards, and
// that is its own direction.
//
// THE BOARD CARRIES EVERY PILE, so "the other twelve" is something to read.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileOf,
  type Harness,
} from "../harness";
import {
  assertOtherPilesUnchanged,
  pileName,
  poseFullBoard,
  WASTE_SETS,
} from "./board";

/** The column emptied by the first check. */
const COLUMN = { pile: "tableau", index: 3 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("empties the named column and leaves the other twelve piles standing", async () => {
  openTable(h);
  poseFullBoard(h);

  const before = h.snapshot();
  assertLength(
    pileOf(before, COLUMN.pile, COLUMN.index),
    2,
    `${pileName(COLUMN)} before the clear, which is what the clear is asked ` +
      "to empty",
  );

  h.debug.clearPile(COLUMN.pile, COLUMN.index);
  const after = h.snapshot();

  // The board with one pile emptied.
  await h.advance(1);
  captureStill(h, "board");

  assertLength(
    pileOf(after, COLUMN.pile, COLUMN.index),
    0,
    `${pileName(COLUMN)}, the pile clearPile named ` +
      "(specs/instrumentation.md)",
  );
  assertOtherPilesUnchanged(
    before,
    after,
    COLUMN,
    "clearPile leaves the other twelve piles standing " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    after.wasteSets,
    WASTE_SETS.length,
    "the waste's set memory, which a clear of a column never touches",
  );
});
