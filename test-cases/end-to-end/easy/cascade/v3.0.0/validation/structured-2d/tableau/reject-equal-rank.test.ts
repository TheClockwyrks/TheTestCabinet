// tableau/reject-equal-rank — a column refuses a card of its lowest card's own rank.
//
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of rank `r - 1` and the color other than `c`, and
// refuses every other run offered to it. Rank `r` itself is not rank `r - 1`.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING RANK. The column's lowest card is the eight of hearts and the
// eight of SPADES is offered: the right color, and no step down at all. So a build
// that asks whether the offered card is at most the column's rank — the off-by-one a
// `<=` writes where a `- 1` belongs — accepts this and fails here, while the color
// test alone cannot tell this card from the seven of spades that
// `build-down-alternating` offers.
//
// The seven that WOULD be accepted is nowhere on the table, so a build cannot come
// out right by sending some other card instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  EIGHT,
  NINE,
  openTable,
  poseColumn,
  TEN,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The column that is offered the card, and the built run standing on it. */
const TARGET = 2;
const TARGET_CARDS = [
  card("hearts", TEN),
  card("spades", NINE),
  card("hearts", EIGHT),
];
/** Its lowest card: red, rank eight. */
const TARGET_LOWEST_TEXT = "8H";

/** The column the offered card waits alone in, and its row there. */
const SOURCE = 5;
/** The same rank, and black, so only the step down is missing. */
const OFFERED = card("spades", EIGHT);
const OFFERED_TEXT = "8S";
const OFFERED_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card of the same rank as the column's lowest card", async () => {
  openTable(h);
  poseColumn(h, TARGET, TARGET_CARDS);
  poseColumn(h, SOURCE, [OFFERED]);
  const before = boardText(h.snapshot());

  const accepted = h.debug.move(
    "tableau",
    SOURCE,
    OFFERED_ROW,
    "tableau",
    TARGET,
  );
  const after = boardText(h.snapshot());
  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    accepted,
    false,
    `move of ${OFFERED_TEXT} onto column ${TARGET}, whose lowest card ` +
      `${TARGET_LOWEST_TEXT} is the SAME rank and the other color ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the offered card is still in its " +
      "column and the target still holds three (specs/tableau.md)",
  );
});
