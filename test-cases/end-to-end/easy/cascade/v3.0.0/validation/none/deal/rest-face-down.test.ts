// Cascade — deal/rest-face-down: every column card above the lowest is face-down.
//
// specs/deal.md, The deal: "In each column, every card is dealt face-down except
// the last one dealt, which is turned face-up. Each column therefore shows
// exactly one face-up card, and it is the column's lowest card on the table."
// The twenty-one cards this covers are the game's hidden half: they are what a
// player uncovers, what specs/tableau.md turns face-up as a column is emptied
// down to them, and what makes a Klondike deal a puzzle rather than an open
// board. A deal that shows them all is a solitaire with nothing to find out.
//
// A pile is reported bottom to top (specs/instrumentation.md), so the cards ABOVE
// the lowest on the table are every entry but the last. Each column is read on
// its own, with the column and the offending faces named, so a build that turned
// one column's whole run face-up says which column.
//
// THE OTHER DIRECTION IS ITS OWN CHECK. That the lowest card of each column IS
// face-up is deal/lowest-face-up, so a build that dealt every card face-down
// fails that one and passes this one.
//
// A column of one card has no card above its lowest, so column 0 contributes
// nothing to this reading. That it holds exactly one card is deal/column-sizes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves every card above a column's lowest face-down", async () => {
  await openTable(h);
  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const { tableau } = await h.snapshot();
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    const cards = tableau[column] ?? [];
    const above = cards.slice(0, Math.max(cards.length - 1, 0));
    assertDeepEqual(
      above.map((card) => card.faceUp),
      above.map(() => false),
      `the faces of the ${above.length} card(s) above column ${column}'s lowest, top of the table first (specs/deal.md)`,
    );
  }
});
