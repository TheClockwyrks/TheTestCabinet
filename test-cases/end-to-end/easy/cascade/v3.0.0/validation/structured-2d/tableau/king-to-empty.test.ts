// tableau/king-to-empty — an empty column takes a King.
//
// specs/tableau.md: an empty column accepts a run led by a King. A single card is a
// run of one, so a King on its own is a run a King leads.
// specs/instrumentation.md: `move` returns `true` when the game's own rules accepted
// it, and `fromRow` counts from the bottom of the source pile.
//
// THE POSE. `openTable` clears all thirteen piles, so the target column holds
// nothing at all — the state the rule names — and the King of spades waits alone in
// another column. Nothing else stands on the table, so no other card could have gone
// instead and no other column could have taken it.
//
// This is the acceptance alone. The refusal the same rule implies is
// `reject-non-king-empty`, and the refusal reached through a released drop rather
// than through `move` is `refused-drop-leaves-empty-column`, each its own item.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  KING,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { pileText } from "./board";

/** The column that holds nothing, which is the state the rule names. */
const EMPTY_COLUMN = 0;
/** The column the King waits alone in, and its row there. */
const SOURCE = 4;
const KING_CARD = card("spades", KING);
const KING_TEXT = "KS";
const KING_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a King onto a column holding nothing", async () => {
  openTable(h);
  poseColumn(h, SOURCE, [KING_CARD]);

  const accepted = h.debug.move(
    "tableau",
    SOURCE,
    KING_ROW,
    "tableau",
    EMPTY_COLUMN,
  );
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${KING_TEXT} onto column ${EMPTY_COLUMN}, which holds nothing ` +
      "and accepts a run led by a King (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[EMPTY_COLUMN]),
    [KING_TEXT],
    `column ${EMPTY_COLUMN} after the move: the King is the one card on it ` +
      "(specs/tableau.md)",
  );
  assertLength(
    after.tableau[SOURCE],
    0,
    `the cards left in column ${SOURCE}: the King has left it ` +
      "(specs/tableau.md)",
  );
});
