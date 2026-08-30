// tableau/accepts-from-foundation — a column takes a card back off a foundation.
//
// specs/tableau.md: "A column accepts a run from another column, from the waste, and
// from a foundation, on exactly the terms above" — a run led by a card one rank
// below the column's lowest card and of the other color.
// specs/foundations.md: a foundation's top card may be moved back onto a tableau
// column that accepts it by the rules in specs/tableau.md.
// specs/instrumentation.md: `move` returns `true` when the game's own rules accepted
// it, and `fromRow` counts from the bottom of the source pile, so a foundation's top
// card is its last row.
//
// THE DIRECTION IS WHAT THIS ITEM IS ABOUT. The clubs foundation is built to its six
// and the column's lowest card is the seven of hearts: red, one rank higher, so the
// black six on top of that foundation is exactly the card that column takes. The
// move names the FOUNDATION as its source, so a build whose column rules answer only
// cards arriving from a column or from the waste refuses it and fails here.
//
// The foundation is built to a middle rank rather than to its Ace, so the card
// pulled back is not also the card that started the pile, and the pile it leaves
// behind is asserted: the column is not to take the whole foundation.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  EIGHT,
  FIVE,
  openTable,
  poseColumn,
  poseFoundation,
  SEVEN,
  SIX,
  type Harness,
} from "../harness";
import { builtText, pileText } from "./board";

/** The foundation the card is pulled off, its suit, and the rank it is built to. */
const FOUNDATION = 1;
const FOUNDATION_SUIT = "clubs";
const FOUNDATION_TOP_RANK = SIX;
/** Its top card, and that card's row, counted from the bottom of the pile. */
const PULLED_TEXT = "6C";
const PULLED_ROW = FOUNDATION_TOP_RANK - 1;
/** What the foundation must hold once its top card has left. */
const LEFT_ON_FOUNDATION = builtText(FOUNDATION_SUIT, FIVE);

/** The column that receives it, and the two cards standing on it. */
const TARGET = 2;
const TARGET_CARDS = [card("spades", EIGHT), card("hearts", SEVEN)];
const TARGET_TEXT = ["8S", "7H"];
/** Its lowest card: red, rank seven, so a black six is what it accepts. */
const TARGET_LOWEST_TEXT = "7H";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a foundation's top card onto a column that takes it", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, FOUNDATION_SUIT, FOUNDATION_TOP_RANK);
  poseColumn(h, TARGET, TARGET_CARDS);

  const accepted = h.debug.move(
    "foundation",
    FOUNDATION,
    PULLED_ROW,
    "tableau",
    TARGET,
  );
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${PULLED_TEXT} off foundation ${FOUNDATION} onto column ` +
      `${TARGET}, whose lowest card ${TARGET_LOWEST_TEXT} is one rank higher ` +
      "and the other color (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[TARGET]),
    [...TARGET_TEXT, PULLED_TEXT],
    `column ${TARGET} after the move: the foundation's card is its new ` +
      "lowest card (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.foundations[FOUNDATION]),
    LEFT_ON_FOUNDATION,
    `foundation ${FOUNDATION} after the move: its top card alone left it ` +
      "(specs/foundations.md)",
  );
});
