// tableau/reject-same-color — a column refuses the next rank down of its own color.
//
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of rank `r - 1` and THE COLOR OTHER THAN `c`, and
// refuses every other run offered to it.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING SUIT. The column's lowest card is the eight of hearts and the
// seven of DIAMONDS is offered: the right rank, the wrong color, and a DIFFERENT
// SUIT. So a build that tests the two suits for inequality — the shape the
// foundations' own rule has, inverted — accepts it and fails here, and so does a
// build that tests the rank alone. The seven of spades and the seven of clubs are
// nowhere on the table, so the refusal cannot come out right by some other card
// going instead.

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
  sameColorSuit,
  SEVEN,
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
const TARGET_LOWEST_SUIT = "hearts";
const TARGET_LOWEST_TEXT = "8H";

/** The column the offered card waits alone in, and its row there. */
const SOURCE = 5;
/** One rank lower, and of the other red suit, so its color is the column's own. */
const OFFERED = card(sameColorSuit(TARGET_LOWEST_SUIT), SEVEN);
const OFFERED_TEXT = "7D";
const OFFERED_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card one rank lower whose color is the column's own", async () => {
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
      `${TARGET_LOWEST_TEXT} is one rank higher and the SAME color ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the offered card is still in its " +
      "column and the target still holds three (specs/tableau.md)",
  );
});
