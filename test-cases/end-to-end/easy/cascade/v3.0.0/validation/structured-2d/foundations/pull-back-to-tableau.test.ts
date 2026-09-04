// foundations/pull-back-to-tableau — a foundation's top card may be pulled back onto
// a column.
//
// specs/foundations.md: "A foundation's top card may be moved back onto a tableau
// column that accepts it by the rules in specs/tableau.md. The card leaves the
// foundation, and the card beneath it becomes that foundation's top card."
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of rank `r - 1` and the other color; a column
// accepts a run from a foundation on exactly those terms.
// specs/instrumentation.md: `fromRow` is the grabbed card's index within its pile,
// counted from the bottom, so a foundation's top card is its last row.
//
// THE POSE. The spade foundation is built to its three, and a column's lowest card
// is the four of hearts: red, one rank higher, so the black three of spades is
// exactly the card that column takes. The move names the foundation as its source,
// which is the direction this item is about — every other item in this group moves a
// card the other way — so a build whose foundations are a one-way pile refuses it
// and fails here.
//
// The card the pull exposes is asserted too: the foundation must be left holding its
// Ace and its 2, with the 2 on top, rather than emptied or left with a hole in it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  FOUR,
  oppositeColorSuit,
  openTable,
  poseColumn,
  poseFoundation,
  THREE,
  TWO,
  type Harness,
} from "../harness";
import { builtText, pileText } from "./board";

/** The foundation the card is pulled off, its suit, and the rank it is built to. */
const FOUNDATION = 0;
const FOUNDATION_SUIT = "spades";
const FOUNDATION_TOP_RANK = THREE;
/** The foundation's top card, and its row, counted from the bottom of the pile. */
const PULLED_TEXT = "3S";
const TOP_ROW = FOUNDATION_TOP_RANK - 1;
/** The column that accepts it: its lowest card is one rank higher and red. */
const COLUMN = 5;
const COLUMN_CARDS = [card(oppositeColorSuit(FOUNDATION_SUIT), FOUR)];
const COLUMN_TEXT = ["4H"];
/** The foundation once its top card has left. */
const LEFT_ON_FOUNDATION = builtText(FOUNDATION_SUIT, TWO);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("moves a foundation's top card back onto a column that accepts it", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseColumn(h, COLUMN, COLUMN_CARDS);

  const accepted = h.debug.move(
    "foundation",
    FOUNDATION,
    TOP_ROW,
    "tableau",
    COLUMN,
  );
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "pulled");

  assertEqual(
    accepted,
    true,
    `move of ${PULLED_TEXT} off foundation ${FOUNDATION} onto column ` +
      `${COLUMN}, whose lowest card ${COLUMN_TEXT[COLUMN_TEXT.length - 1]} ` +
      "is one rank higher and the other color (specs/foundations.md, " +
      "specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[COLUMN]),
    [...COLUMN_TEXT, PULLED_TEXT],
    `column ${COLUMN} after the move: the pulled card is its new lowest card ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    LEFT_ON_FOUNDATION,
    `foundation ${FOUNDATION} after the move: the card has left it and the ` +
      "card beneath it is its top card (specs/foundations.md)",
  );
});
