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
//
// THE PRESS IS READ BEFORE THE CARD IS CARRIED ANYWHERE, and it has to be. "The
// board is as it was" is exactly what a build that never picked the Queen up leaves
// behind, so without that reading a build whose press grabs nothing would pass this
// point by doing nothing at all. So the gesture is driven in three parts — the press,
// the carry, the release — and the run in hand is read between the first and the
// second: the Queen alone, off the column she was pressed on. What a press picks up
// is `handling.press-grabs-column-run`'s requirement, and it is a precondition here.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  card,
  captureStill,
  createHarness,
  dropRectOf,
  grabPoint,
  movePointerTo,
  openTable,
  poseColumn,
  pressAt,
  QUEEN,
  rectCenter,
  releaseAt,
  type Harness,
  type Point,
} from "../harness";
import { boardText, pileText } from "./board";

/** The column that holds nothing, and the centre of the rectangle it answers. */
const EMPTY_COLUMN = 0;
const RELEASE_POINT = rectCenter(dropRectOf("tableau", EMPTY_COLUMN, []));

/** The column the Queen is lifted from, and her row there. */
const SOURCE = 3;
const QUEEN_CARD = card("spades", QUEEN);
const QUEEN_TEXT = "QS";
const QUEEN_ROW = 0;

/**
 * Moves the carry is delivered in, matching the shared `drag` helper.
 *
 * The gesture is driven here rather than through `drag` only so the run in hand
 * can be read between the press and the carry; the samples are the same ones.
 */
const CARRY_STEPS = 8;

let h: Harness;

/** The carry: `CARRY_STEPS` moves interpolated from the press to the release. */
function carry(from: Point, to: Point): void {
  for (let step = 1; step <= CARRY_STEPS; step += 1) {
    const along = step / CARRY_STEPS;
    movePointerTo(
      h,
      from.x + (to.x - from.x) * along,
      from.y + (to.y - from.y) * along,
    );
  }
}

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

  pressAt(h, grab.x, grab.y);
  const held = h.snapshot();

  assertDeepEqual(
    pileText(held.drag?.cards ?? []),
    [QUEEN_TEXT],
    `the run in hand after the press on ${QUEEN_TEXT} in column ${SOURCE}: a ` +
      "press on a face-up card lifts it, and a board that stands as it was is " +
      "what a press picking nothing up would leave behind too " +
      "(specs/controls.md)",
  );

  carry(grab, RELEASE_POINT);
  releaseAt(h, RELEASE_POINT.x, RELEASE_POINT.y);
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
