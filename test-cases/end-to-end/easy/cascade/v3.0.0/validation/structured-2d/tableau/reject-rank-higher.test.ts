// tableau/reject-rank-higher — a column refuses a card one rank ABOVE its lowest.
//
// specs/tableau.md: a column whose lowest card is face-up, of rank `r` and color
// `c`, accepts a run led by a card of RANK `r - 1` and the color other than `c`, and
// refuses every other run offered to it.
// specs/instrumentation.md: a refused `move` returns `false` and leaves the board
// unchanged.
//
// THE DISTINGUISHING RANK. The column's lowest card is the eight of hearts and the
// nine of CLUBS is offered: the right color, one rank the WRONG WAY. So a build that
// compares the two ranks for a difference of one in either direction — the shape a
// build writes when it reaches for the size of the gap rather than the direction of
// it — accepts this and fails here, while the color test alone cannot tell this card
// from the seven of spades that `build-down-alternating` offers.
//
// The nine of spades stands in the column above the eight, so the offered nine is
// the black nine of clubs; a build that answered by rank alone, ignoring which card
// it was handed, is not helped by that.

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
/** One rank HIGHER, and black, so only the rank is wrong. */
const OFFERED = card("clubs", NINE);
const OFFERED_TEXT = "9C";
const OFFERED_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a card one rank higher than the column's lowest card", async () => {
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
      `${TARGET_LOWEST_TEXT} is one rank LOWER and the other color ` +
      "(specs/tableau.md)",
  );
  assertDeepEqual(
    after,
    before,
    "the board after the refused move: the offered card is still in its " +
      "column and the target still holds three (specs/tableau.md)",
  );
});
