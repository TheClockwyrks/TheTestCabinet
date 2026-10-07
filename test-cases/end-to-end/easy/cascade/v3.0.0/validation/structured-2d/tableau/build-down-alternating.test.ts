// tableau/build-down-alternating — a column takes the next rank down of the other
// color.
//
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of rank `r - 1` and the color other than `c`. A
// single card is a run of one.
// specs/table.md: a column is fanned downward, so its top card is the one drawn
// LOWEST on the table, and that card is the one a run is stacked onto.
// specs/instrumentation.md: `move` returns `true` when the game's own rules accepted
// it, and `fromRow` counts from the bottom of the source pile.
//
// THE POSE. The target column is a built run of three — the ten of hearts, the nine
// of spades, the eight of hearts — so the card the rule names is its LOWEST card,
// the eight of hearts, and not the card at the bottom of the pile. A build that
// tested the pile's bottom card would demand a black nine and refuse the seven of
// spades offered here, so it fails, while a build reading the lowest card accepts.
// The offered card is a middle rank, so nothing about an Ace or a King is what makes
// this work.
//
// This is the acceptance alone. The four refusals the same rule implies are
// `reject-same-color`, `reject-rank-higher`, `reject-rank-gap` and
// `reject-equal-rank`, each its own item, so a build with the color test right and
// the rank test wrong grades differently from one with both wrong.

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

/** The column the offered card waits alone in, and its row there. */
const SOURCE = 5;
const OFFERED = card("spades", SEVEN);
const OFFERED_TEXT = "7S";
const OFFERED_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts a card one rank lower and the other color onto a column's lowest card", async () => {
  openTable(h);
  poseColumn(h, TARGET, TARGET_CARDS);
  poseColumn(h, SOURCE, [OFFERED]);

  const accepted = h.debug.move(
    "tableau",
    SOURCE,
    OFFERED_ROW,
    "tableau",
    TARGET,
  );
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    `move of ${OFFERED_TEXT} onto column ${TARGET}, whose lowest card ` +
      `${TARGET_LOWEST_TEXT} is one rank higher and the other color ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    pileText(after.tableau[TARGET]),
    [...TARGET_TEXT, OFFERED_TEXT],
    `column ${TARGET} after the move: the accepted card is its new lowest ` +
      "card, under the run it landed on (specs/tableau.md)",
  );
  assertLength(
    after.tableau[SOURCE],
    0,
    `the cards left in column ${SOURCE}: the card has left it ` +
      "(specs/tableau.md)",
  );
});
