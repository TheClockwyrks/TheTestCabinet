// automove/flips-exposed — an auto-move turns the card it exposes.
//
// specs/tableau.md: when an accepted move leaves a column whose lowest card is
// face-down, that card is turned face-up, and only that one card turns.
// specs/instrumentation.md: an accepted auto-move applies through the same path a
// released drop uses, so a newly exposed column card turns.
//
// THE COLUMN IS THE SMALLEST ONE THE RULE NEEDS: one face-down card with the
// column's only face-up card below it, and the foundation started so that face-up
// card goes home. The auto-move therefore leaves the face-down card lowest, which is
// exactly the condition the turning rule names.
//
// WHAT IS READ IS THE ONE CARD'S FACE, found by the id it was posed with, so the
// verdict is the turn itself rather than the column's shape. The automatic turn is
// left switched on, because it IS this item's requirement; `setAutoFlip` is for the
// checks that need it held still.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import {
  ACE,
  captureStill,
  card,
  cardById,
  createHarness,
  down,
  openTable,
  poseColumn,
  poseFoundation,
  SEVEN,
  TWO,
  type Harness,
} from "../harness";

/** The started foundation, so the column's face-up card has a home to go to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_UP_TO = ACE;
/** The column in play. */
const COLUMN = 6;
/** The card that is uncovered, drawn above the playable one and face-down. */
const BURIED = down(card("clubs", SEVEN));
const BURIED_TEXT = "#7C";
/** The column's lowest face-up card, which the auto-move sends home. */
const GOES = card(FOUNDATION_SUIT, TWO);
const GOES_TEXT = "2S";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the card the auto-move uncovered face-up", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_UP_TO);
  const [buriedId] = poseColumn(h, COLUMN, [BURIED, GOES]);

  const went = h.debug.autoMove("tableau", COLUMN);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "flipped");

  assertEqual(
    went,
    true,
    `autoMove("tableau", ${COLUMN}) with ${GOES_TEXT} lowest in that column ` +
      "and the Ace of spades home (specs/instrumentation.md)",
  );
  const buried = cardById(after, buriedId);
  if (buried === undefined) {
    fail(
      `${BURIED_TEXT} to still be on the table after the auto-move took the ` +
        `card below it (specs/tableau.md: a move takes the named card and ` +
        `every card below it, so this one stays in column ${COLUMN})`,
      "the card is on no pile",
    );
  }
  assertEqual(
    buried.faceUp,
    true,
    `the face of ${BURIED_TEXT}, the card the accepted move left lowest in ` +
      `column ${COLUMN} (specs/tableau.md: it is turned face-up)`,
  );
});
