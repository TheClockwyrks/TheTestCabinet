// stock/waste-top-to-tableau — the waste's top card can go to a column.
//
// THE RULE. specs/stock.md: the waste's top card may be played "onto a column that
// accepts it by `specs/tableau.md`", and specs/tableau.md: a column accepts a run
// from another column, from the waste, and from a foundation, on exactly its own
// terms. The waste is the other half of the game's supply, and a card that cannot
// reach the tableau from it can only ever go home, which is not Klondike.
//
// THE COLUMN IS POSED WITH ONE FACE-UP CARD the offered card belongs under: the
// column's lowest card is a black eight and the waste's top card is a red seven, so
// specs/tableau.md's run "led by a card of rank `r - 1` and the colour other than
// `c`" is satisfied by the simplest arrangement there is. What is decided here is
// the ROUTE, waste to column; which runs a column accepts and refuses is the
// `tableau` group's seventeen points.
//
// A CARD IS LEFT UNDER IT on the waste, so "leaves the waste" is one card departing
// rather than a pile being cleared, and the column is read as the two cards in
// order, so a build that dropped the arriving card in above the eight rather than
// below it is caught.
//
// Cards are followed by id, which they keep across a move
// (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  card,
  createHarness,
  EIGHT,
  NINE,
  openTable,
  poseColumn,
  poseWaste,
  SEVEN,
  type Harness,
} from "../harness";

/** The column the card lands on: one face-up black eight. */
const POSED_COLUMN = [card("spades", EIGHT)];

/** Which column it is. Any of the seven would do. */
const COLUMN = 0;

/**
 * The waste the card is played off: a card the play leaves behind, and a red seven
 * on top of it, each on a set of its own so the seven is the card shown.
 */
const POSED_WASTE = [card("diamonds", NINE), card("hearts", SEVEN)];
const POSED_SETS = [1, 1] as const;

/** The row the seven sits at, counted from the bottom of the waste. */
const SEVEN_ROW = POSED_WASTE.length - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("accepts the waste's top card onto a column and takes it off the waste", async () => {
  openTable(h);
  const column = poseColumn(h, COLUMN, POSED_COLUMN);
  const ids = poseWaste(h, POSED_WASTE, POSED_SETS);
  const seven = ids[SEVEN_ROW];

  const accepted = h.debug.move("waste", 0, SEVEN_ROW, "tableau", COLUMN);
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "accepted");

  assertEqual(
    accepted,
    true,
    "move() to accept the waste's red seven onto a column whose lowest card is " +
      "a black eight (specs/stock.md)",
  );
  assertDeepEqual(
    (after.tableau[COLUMN] ?? []).map((reported) => reported.id),
    [...column, seven],
    `the ids in column ${COLUMN}, bottom first, after the waste's card landed ` +
      "beneath the eight (specs/tableau.md)",
  );
  assertLength(
    after.waste,
    POSED_WASTE.length - 1,
    "cards left on the waste once its top card went to a column " +
      "(specs/stock.md)",
  );
});
