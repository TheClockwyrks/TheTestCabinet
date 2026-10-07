// Cascade — table/compression-relaxes: a column that compressed and then lost
// cards fans at the plain offset again.
//
// specs/table.md, Long-column compression: "The fit is made per column and per
// frame, so a column that compressed and then lost cards draws the full `34`
// offset again."
//
// THE WRONG MODEL THIS DECIDES IS THE CACHED ONE. A build that works out a
// column's offset when the column is built, or when a card is added to it, and
// keeps the answer, draws a correctly compressed column and a correctly fitted
// one — and then leaves the column squashed for the rest of the game once the
// cards come off it. Nothing but shortening a compressed column tells the two
// apart, so the check drives exactly that and reads the end state.
//
// Fourteen face-up cards would reach `180 + 13 x 34 + 140 = 762` at the plain
// offset, so they are compressed to `(676 - 140 - 180) / 13 = 27.38`. Three
// cards are then taken off the bottom of the column, leaving eleven, which reach
// `180 + 10 x 34 + 140 = 660` — inside `COLUMN_BOTTOM_LIMIT` (`676`) with room
// to spare, so the specified drawing is the plain `34` under every card.
//
// ONLY THE END STATE IS ASSERTED, deliberately. A build that never compresses
// anything also draws `34` here and passes, and it is charged by
// `column-compression`, which is the point that owns the other direction. The
// cards are taken off with `removeCard`, which is a pose rather than a move
// (specs/instrumentation.md), so no move rule and no automatic flip is on the
// route to the state being read.
//
// WHICH x THE BUILD DREW THE COLUMN AT IS NOT READ HERE. The column is found as
// the group of card-sized boxes below the top row that share a left edge and
// holds the most of them: on a table where one column is posed and the other six
// show a single empty mark each, that group is the posed column wherever the
// build put it. So a build that fanned its cards correctly at the wrong anchor
// is read here exactly like one that did not, and fails `column-anchors` alone.
// The fan is posed on column `2`, the one column position the top row leaves
// empty (specs/table.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength } from "../assert";
import { FACE_UP_OFFSET } from "../constants";
import {
  captureReplay,
  createHarness,
  fullDeck,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";
import {
  busiestColumn,
  cardBoxes,
  corners,
  rowGaps,
  rowTops,
  tableauBoxes,
} from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140`, as a fraction of each
 * side, and still be READ as a card.
 *
 * This is identification and not a requirement: it is how a check picks the
 * cards out of a frame that also drew pips, ranks, the felt and the HUD strip,
 * and it is deliberately loose so that the ONE point about the footprint is the
 * one that decides it. A build that drew every card a few units small has its
 * geometry read here exactly like any other and is charged once, by `card-size`.
 * A fifth of each side is far wider than a defect of that kind and far narrower
 * than anything else this game puts on the table.
 */
const CARD_LIKE_TOLERANCE = 0.2;

/**
 * How far two cards' left edges may differ and still be read as the same column,
 * in logical units.
 *
 * The column is found as the group of card-sized boxes that share a left edge
 * and holds the most of them, so this decides which boxes are grouped together
 * and never where the group had to be. The nearest column position is a pitch
 * away, `122` units, so one unit is snapping room and cannot merge two columns.
 */
const SAME_COLUMN_TOLERANCE = 1;

/**
 * How close two drawn top edges must be to count as one row, in logical units.
 * The shortened column fans its cards `34` apart, so two units can only merge a
 * card's outline with its own fill.
 */
const ROW_TOLERANCE = 2;

/**
 * How far a gap of the shortened column may sit from `FACE_UP_OFFSET` (`34`), in
 * logical units.
 *
 * The offset is a whole number and eleven cards are well inside the line, so a
 * conformant build draws exactly `34`; one unit is the same snapping allowance
 * the anchors get. A build that kept the compressed offset draws `27.38`, more
 * than six units away.
 */
const OFFSET_TOLERANCE = 1;

/** The column the fan is posed on: the one with no pile above it in the top row. */
const COLUMN = 2;

/** How many cards the column starts with, and how many are then taken off it. */
const CARDS = 14;
const REMOVED = 3;

/**
 * Frames held between one card leaving the column and the next, at the harness's
 * sixty-hertz clock — a fifth of a second each, so the recorded evidence shows
 * the column expanding a step at a time rather than jumping.
 */
const HOLD = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns a shortened column to the 34 offset", async () => {
  openTable(h);
  const ids = poseColumn(h, COLUMN, fullDeck().slice(0, CARDS));

  const calls = await captureReplay(h, "relaxing", async () => {
    // The compressed column, held long enough to be seen in the recording.
    await h.advance(HOLD);
    for (let taken = 0; taken < REMOVED; taken += 1) {
      h.debug.removeCard(ids[CARDS - 1 - taken]);
      await h.advance(HOLD);
    }
    return h.drawFrame();
  });

  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);
  const column = busiestColumn(tableauBoxes(boxes), SAME_COLUMN_TOLERANCE);
  const rows = rowTops(column, ROW_TOLERANCE);

  assertLength(
    rows,
    CARDS - REMOVED,
    `the ${CARDS - REMOVED} cards left on the column drawn as that many rows ` +
      `of their own; the frame drew the column's card-sized boxes at ` +
      `${corners(column)}`,
  );

  const gaps = rowGaps(rows);
  gaps.forEach((gap, index) => {
    assertBetween(
      gap,
      FACE_UP_OFFSET - OFFSET_TOLERANCE,
      FACE_UP_OFFSET + OFFSET_TOLERANCE,
      `the gap under card ${index} of the column, after it lost ${REMOVED} ` +
        `of its ${CARDS} cards`,
    );
  });
});
