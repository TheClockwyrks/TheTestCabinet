// tableau/accepts-from-waste — a column takes the waste's card on the tableau's own
// terms.
//
// specs/tableau.md: "A column accepts a run from another column, from the waste, and
// from a foundation, on exactly the terms above" — a run led by a card one rank
// below the column's lowest card and of the other color.
// specs/stock.md: only the waste's top card may be played, and a waste whose set
// memory is empty offers none, so the card posed here is given the one turned set it
// belongs to.
// specs/instrumentation.md: `move` returns `true` when the game's own rules accepted
// it, and `fromRow` counts from the bottom of the source pile.
//
// THE DIRECTION IS WHAT THIS ITEM IS ABOUT. Every other acceptance in this group
// moves a card between columns; this one names the WASTE as the source, so a build
// whose column rules answer only cards arriving from another column refuses it and
// fails here. The target column is a built run of three, so the card the rule names
// is its lowest card and not the card at the bottom of the pile, and the offered
// black seven is one rank below that red eight.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  EIGHT,
  NINE,
  openTable,
  poseColumn,
  poseWaste,
  SEVEN,
  TEN,
  type Harness,
} from "../harness";
import { pileText } from "./board";

/** The column that receives the card, and the built run standing on it. */
const TARGET = 2;
const TARGET_CARDS = [
  card("hearts", TEN),
  card("spades", NINE),
  card("hearts", EIGHT),
];
const TARGET_TEXT = ["10H", "9S", "8H"];
/** Its lowest card: red, rank eight, so a black seven is what it accepts. */
const TARGET_LOWEST_TEXT = "8H";

/** The waste's one card, the one set it was turned in, and its row on the waste. */
const WASTE_CARD = card("spades", SEVEN);
const WASTE_CARD_TEXT = "7S";
const WASTE_SETS = [1];
const WASTE_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the waste's top card onto a column that takes it", async () => {
  openTable(h);
  poseColumn(h, TARGET, TARGET_CARDS);
  poseWaste(h, [WASTE_CARD], WASTE_SETS);

  const accepted = h.debug.move("waste", 0, WASTE_ROW, "tableau", TARGET);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${WASTE_CARD_TEXT} off the waste onto column ${TARGET}, whose ` +
      `lowest card ${TARGET_LOWEST_TEXT} is one rank higher and the other ` +
      "color (specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[TARGET]),
    [...TARGET_TEXT, WASTE_CARD_TEXT],
    `column ${TARGET} after the move: the waste's card is its new lowest ` +
      "card (specs/tableau.md)",
  );
  assertLength(
    after.waste,
    0,
    "the cards left on the waste: the card has left it (specs/stock.md)",
  );
});
