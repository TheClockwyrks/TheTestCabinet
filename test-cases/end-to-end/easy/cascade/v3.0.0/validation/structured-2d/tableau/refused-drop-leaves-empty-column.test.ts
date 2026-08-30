// tableau/refused-drop-leaves-empty-column — a non-King released over an empty
// column is refused, and the column is still empty.
//
// specs/tableau.md: an empty column accepts a run led by a King and refuses every
// other run. "A refused move changes nothing. Every card it carried returns to the
// pile it was taken from, in the order it left, with every face as it was, and the
// target keeps what it held. A column that was empty when a run was refused by it is
// still empty."
// specs/controls.md: a release farther than `DRAG_THRESHOLD` from its press is a
// drop, and a drop resolves to the pile whose drop rectangle contains THE CENTRE OF
// THE RUN'S LEADING CARD; a pile that refuses the run returns it to the pile it was
// lifted from.
// specs/table.md: an empty column's drop rectangle is `CARD_W x CARD_H` at
// `(COLUMN_X[i], TABLEAU_Y)`.
//
// WHY THIS IS NOT `reject-non-king-empty`. That item asks the rules directly, through
// `move`. This one goes the whole way a player goes: the Queen is picked up by a
// press, carried across the table, and released with her centre inside the empty
// column's own drop rectangle — so it decides that the refusal survives the release
// path, and that the run is put back rather than dropped, kept in hand, or left on
// the empty column. The press lands on the Queen's centre, so the run keeps a zero
// offset and her centre is exactly where the pointer is; the release point is the
// centre of that rectangle, which is as far inside it as a point can be.
//
// The whole board is compared before and after, so a build that refused the drop and
// then left the Queen somewhere else — or emptied her column, or turned her over —
// fails as well, and `drag` is read so a build that simply kept holding her fails
// too.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  drag,
  dropRectOf,
  grabPoint,
  openTable,
  poseColumn,
  QUEEN,
  rectCenter,
  type Harness,
} from "../harness";
import { boardText } from "./board";

/** The column that holds nothing, and the centre of the rectangle it answers. */
const EMPTY_COLUMN = 0;
const RELEASE_POINT = rectCenter(dropRectOf("tableau", EMPTY_COLUMN, []));

/** The column the Queen is lifted from, and her row there. */
const SOURCE = 3;
const QUEEN_CARD = card("spades", QUEEN);
const QUEEN_TEXT = "QS";
const QUEEN_ROW = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a Queen released over an empty column and leaves the column empty", async () => {
  openTable(h);
  poseColumn(h, SOURCE, [QUEEN_CARD]);
  const before = boardText(h.snapshot());
  const grab = grabPoint(h.snapshot(), SOURCE, QUEEN_ROW);

  drag(h, grab, RELEASE_POINT);
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "refused");

  assertDeepEqual(
    boardText(after),
    before,
    `the board after ${QUEEN_TEXT} was released with her centre inside the ` +
      `drop rectangle of column ${EMPTY_COLUMN}, which holds nothing and ` +
      `accepts a King alone: column ${EMPTY_COLUMN} still holds nothing and ` +
      `the Queen is back in column ${SOURCE} (specs/tableau.md)`,
  );
  assertNull(
    after.drag,
    "the run in hand once the gesture is over: the release ended it " +
      "(specs/controls.md)",
  );
});
