// Cascade — deal/lowest-face-up: each column's lowest card is turned face-up.
//
// specs/deal.md, The deal: "In each column, every card is dealt face-down except
// the last one dealt, which is turned face-up. Each column therefore shows
// exactly one face-up card, and it is the column's lowest card on the table."
// Those seven cards are the whole of the opening position: specs/tableau.md lets
// a grab take a face-up card and refuses a move whose source card is face-down,
// so a deal that turned none of them leaves a game with no first move.
//
// A pile is reported bottom to top (specs/instrumentation.md), so a column's
// LOWEST card on the table is its LAST entry. Each of the seven is read on its
// own, with the column named on the failure, so a build that turned six of them
// says which one it missed.
//
// THE OTHER DIRECTION IS ITS OWN CHECK. That the twenty-one cards above the
// lowest are face-down is deal/rest-face-down, so a build that dealt every card
// face-up fails that one and passes this one, and a build that dealt every card
// face-down fails this one alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { TABLEAU_COLUMNS } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  topOf,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("turns the lowest card of every column face-up", async () => {
  await openTable(h);
  await h.debug.deal();
  await h.advance(1);
  await captureStill(h, "dealt");

  const { tableau } = await h.snapshot();
  for (let column = 0; column < TABLEAU_COLUMNS; column += 1) {
    const cards = tableau[column] ?? [];
    const lowest = topOf(cards);
    if (lowest === undefined) {
      fail(
        `column ${column} to hold the cards the deal dealt it, so its lowest card can be read (specs/deal.md)`,
        `column ${column} holds no cards`,
      );
    }
    assertEqual(
      lowest.faceUp,
      true,
      `the face of column ${column}'s lowest card (specs/deal.md)`,
    );
  }
});
