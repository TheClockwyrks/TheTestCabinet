// foundations/accepts-from-tableau — a foundation accepts a column's lowest card.
//
// specs/foundations.md: "A foundation accepts a card from a tableau column and from
// the waste, on exactly the terms above" — the terms being the next rank up of its
// own suit.
// specs/tableau.md: a move out of a column takes the named card and every card below
// it, so a move naming a column's lowest card takes that card alone, and the cards
// above it stay in the column in their order and with their faces unchanged.
// specs/instrumentation.md: `fromRow` is the grabbed card's index within its pile,
// counted from the bottom.
//
// THE POSE. The spade foundation is built to its five, and a column holds the seven
// of hearts with the six of spades fanned below it. The six is the column's lowest
// card and the one the foundation is owed; the seven stays where it is. So this
// reads a card leaving the BOTTOM of a fanned column, which is where a column gives
// cards up, and a build that can only play a column holding one card fails.
//
// Both cards are face-up, so nothing here turns: the automatic turning of a newly
// exposed card is the `tableau` group's own requirement and no faculty of it is
// exercised by this pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openTable,
  pileSpecs,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";

/** The started foundation, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_TOP_RANK = 5;
/** The column the cards wait in, top card first. */
const COLUMN = 2;
const COLUMN_CARDS = ["7H", "6S"];
/** The lowest card's row in the column, counted from the bottom of the pile. */
const LOWEST_ROW = COLUMN_CARDS.length - 1;
/** The foundation once the move has landed. */
const BUILT = ["AS", "2S", "3S", "4S", "5S", "6S"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a column's lowest card onto the foundation it belongs on", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, COLUMN_CARDS);

  const accepted = h.debug.move(
    "tableau",
    COLUMN,
    LOWEST_ROW,
    "foundation",
    FOUNDATION,
  );
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${COLUMN_CARDS[LOWEST_ROW]} from column ${COLUMN} onto the ` +
      `spade foundation built to its ${FOUNDATION_TOP_RANK}: a foundation ` +
      "accepts from a column on the same terms (specs/foundations.md)",
  );
  assertDeepEqual(
    pileSpecs(after.foundations[FOUNDATION]),
    BUILT,
    `foundation ${FOUNDATION} after the move: the column's card on top of it ` +
      "(specs/foundations.md)",
  );
  assertDeepEqual(
    pileSpecs(after.tableau[COLUMN]),
    COLUMN_CARDS.slice(0, LOWEST_ROW),
    `column ${COLUMN} after the move: the card above the one taken is still ` +
      "there, face-up and in its order (specs/tableau.md)",
  );
});
