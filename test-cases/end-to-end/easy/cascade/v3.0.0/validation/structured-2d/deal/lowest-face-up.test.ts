// deal/lowest-face-up — every column's lowest card is dealt face-up.
//
// THE RULE. specs/deal.md: "In each column, every card is dealt face-down except
// the last one dealt, which is turned face-up. Each column therefore shows exactly
// one face-up card, and it is the column's lowest card on the table." Those seven
// cards are the whole of what a player can see and play at the start of a game, so
// a build that deals them face-down deals an unplayable board.
//
// WHICH CARD IS THE LOWEST. specs/instrumentation.md orders every pile from its
// bottom card to its top card and states that in a tableau column the last element
// is the card drawn lowest on the table. So the card this reads is the LAST entry
// of each column, whatever a build calls it internally.
//
// ONE DIRECTION ONLY. This decides that the seven lowest cards are face-up. That
// the twenty-one cards above them are face-down is `deal/rest-face-down`, so a
// build that deals every card face-up fails that item and passes this one, and a
// build that deals every card face-down fails this one alone.
//
// A column that a deal left empty is a fault this item reports as well, because a
// column with no lowest card shows none, and `deal/column-sizes` names the missing
// cards separately.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  cardKey,
  createHarness,
  openTable,
  pileOf,
  topOf,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("turns the last card dealt to each column face-up", async () => {
  openTable(harness);
  harness.debug.deal();

  await harness.advance(1);
  captureStill(harness, "dealt");

  const dealt = harness.snapshot();
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    const lowest = topOf(pileOf(dealt, "tableau", column));
    if (lowest === undefined) {
      fail(
        `a lowest card in column ${column}, which a deal turns face-up ` +
          "(specs/deal.md)",
        "a column a deal left empty",
      );
    }
    assertEqual(
      lowest.faceUp,
      true,
      `column ${column}'s lowest card, the ${cardKey(lowest)}, face-up ` +
        "(specs/deal.md)",
    );
  }
});
