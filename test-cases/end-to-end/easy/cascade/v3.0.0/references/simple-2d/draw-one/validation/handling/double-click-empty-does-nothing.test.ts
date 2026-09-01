// handling/double-click-empty-does-nothing — two quick presses on the bare table
// change nothing.
//
// specs/controls.md: a press is a double click only when, among two other
// conditions, "it lands on a playable card", and "a playable card is the waste's top
// card or a column's lowest face-up card". A press that lands on no card lifts
// nothing, and a release with nothing in hand and no control or stock under its
// press "changes nothing". So two presses on bare table leave the board exactly as
// it stood.
//
// THERE IS A CARD THAT WOULD HAVE GONE HOME. The Ace of spades is on a foundation
// and the two of spades waits in a column, which is precisely the board
// `handling/double-click-auto-moves` drives to a foundation — so a build that sends
// a card home on any quick pair of presses, rather than on a pair that lands on that
// card, moves it here and fails. On an empty table the same build would have nothing
// to move and would pass.
//
// WHERE THE PRESSES LAND. In the `22`-unit gap specs/table.md fixes between two
// columns, at the height of the card posed beside it, so the point is bare table by
// the specification's own arithmetic and differs from a card in one coordinate only.
//
// The two presses are driven with no frame between them, so they are `0` seconds and
// `0` units apart and satisfy `DOUBLE_CLICK_WINDOW` and `DOUBLE_CLICK_SLOP` as
// completely as two presses can. The only condition they fail is the one this point
// is about.

import { afterEach, beforeEach, it } from "vitest";
import { CARD_W, COLUMN_X } from "../../src/constants";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  doubleClickAt,
  openTable,
  poseColumn,
  poseFoundation,
  type Harness,
} from "../harness";
import { boardAndHand } from "./board";

/** The foundation the Ace of spades starts, and the card that could go home. */
const FOUNDATION = 0;
const COLUMN = 3;
const CARD = "2S";

/**
 * The bare point both presses land on: the middle of the gap between the column the
 * card stands in and the column to its left, level with that card.
 *
 * `COLUMN_X[COLUMN - 1] + CARD_W` is the right edge of the cards in the column
 * before, and `COLUMN_X[COLUMN]` the left edge of the card itself, so the midpoint
 * lies in the `22`-unit gap where specs/table.md says nothing card-sized is drawn.
 */
const BARE = {
  x: (COLUMN_X[COLUMN - 1] + CARD_W + COLUMN_X[COLUMN]) / 2,
  y: 250,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the board as it was when two quick presses land on no card", async () => {
  openTable(h);
  poseFoundation(h, FOUNDATION, "spades", 1);
  poseColumn(h, COLUMN, [CARD]);
  const before = boardAndHand(h.snapshot());

  doubleClickAt(h, BARE.x, BARE.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unchanged");

  assertDeepEqual(
    boardAndHand(after),
    before,
    `the board and the hand after two presses at (${BARE.x}, ${BARE.y}), in ` +
      "the gap between two columns: a double click is a press that lands on a " +
      "playable card, and this one lands on no card at all " +
      "(specs/controls.md, specs/table.md)",
  );
});
