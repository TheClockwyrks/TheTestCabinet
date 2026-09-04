// handling/press-bare-table-grabs-nothing — a press on the bare table lifts nothing.
//
// specs/controls.md: "A press that lands on no card lifts nothing." So `drag` stays
// null and no pile gives anything up.
//
// WHERE THE BARE TABLE IS. specs/table.md fixes the seven columns at a pitch of
// `122`, which is "a `100`-wide card and a `22` gap", and states that "the gaps
// between the columns carry no pile and nothing card-sized is drawn in them". The
// press below lands in the middle of the gap between the first two columns, at the
// height of the card posed in the first — so it is bare table by the specification's
// own arithmetic, and a build whose column hit test asks only whether the pointer is
// somewhere in the tableau band, or which column is nearest, answers it with a card.
//
// THERE IS A CARD ON THE TABLE, and it is face-up and liftable. A press on the bare
// table of an empty table would be answered with an empty hand by a build that never
// lifts anything at all; posing a card the press does NOT land on is what makes the
// empty hand mean something.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import { CARD_W, COLUMN_X } from "../constants";
import {
  captureStill,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import { boardAndHand } from "./board";

/** The column holding the one card on the table, and that card. */
const COLUMN = 0;
const CARD = "5H";

/**
 * The bare point the press lands on: the middle of the gap between the first two
 * columns, level with the card in the first.
 *
 * `COLUMN_X[0] + CARD_W` is the right edge of column 0's cards and `COLUMN_X[1]` the
 * left edge of column 1's, so the midpoint of the two lies in the `22`-unit gap
 * specs/table.md fixes between them, where nothing card-sized is drawn. The height
 * is inside the posed card's own footprint, so the point differs from that card in
 * one coordinate only.
 */
const BARE = {
  x: (COLUMN_X[COLUMN] + CARD_W + COLUMN_X[COLUMN + 1]) / 2,
  y: 250,
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the hand empty and the board as it was on a press over bare table", async () => {
  openTable(h);
  poseColumn(h, COLUMN, [CARD]);
  const before = boardAndHand(h.snapshot());

  h.debug.pointerDown(BARE.x, BARE.y);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "unheld");

  assertNull(
    after.drag,
    `the run in hand after a press at (${BARE.x}, ${BARE.y}), in the gap ` +
      "between two columns: a press that lands on no card lifts nothing " +
      "(specs/controls.md, specs/table.md)",
  );
  assertDeepEqual(
    boardAndHand(after),
    before,
    "the board and the hand after that press: no pile gave a card up " +
      "(specs/controls.md)",
  );
});
