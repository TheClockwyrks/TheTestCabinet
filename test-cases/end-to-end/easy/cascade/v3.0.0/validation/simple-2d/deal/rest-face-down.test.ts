// deal/rest-face-down — every column card above the lowest is dealt face-down.
//
// THE RULE. specs/deal.md: "In each column, every card is dealt face-down except
// the last one dealt, which is turned face-up. Each column therefore shows exactly
// one face-up card." The twenty-one cards those seven sit on are the game's buried
// half, and a build that deals them face-up gives the player a board with no hidden
// information, which is a different game.
//
// WHICH CARDS THEY ARE. specs/instrumentation.md orders a pile from its bottom card
// to its top card, and the column's lowest card on the table is the LAST entry, so
// these are every entry BEFORE the last, in every column.
//
// ONE DIRECTION ONLY. This decides that the buried cards are face-down. That the
// lowest card of each column is face-up is `deal/lowest-face-up`, so the two
// directions grade separately and a build that deals every card face-down fails
// only that one.
//
// EVERY CARD IS NAMED. Each buried card is its own assertion carrying its column
// and its row, so a build that leaves one column's cards face-up fails with that
// column named rather than with a count.

import { afterEach, beforeEach, it } from "vitest";
import { TABLEAU_COLUMNS } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  cardSpec,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("leaves every card above a column's lowest face-down", async () => {
  openTable(harness);
  harness.debug.deal();

  await harness.advance(1);
  captureStill(harness, "dealt");

  const { tableau } = harness.snapshot();
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    const cards = tableau[column] ?? [];
    for (let row = 0; row < cards.length - 1; row += 1) {
      assertEqual(
        cards[row].faceUp,
        false,
        `column ${column} row ${row}, the card ${cardSpec(cards[row])} buried ` +
          "under the column's lowest, face-down (specs/deal.md)",
      );
    }
  }
});
