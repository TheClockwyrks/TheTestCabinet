// Cascade — table/card-size: a card covers `100 x 140` at its position, wherever
// on the table it sits.
//
// specs/table.md, A card: "Every card occupies a `CARD_W x CARD_H` (`100 x 140`)
// rectangle. That is its footprint wherever it sits: in a pile, overlapped in a
// column, held in hand, or in flight during the victory cascade."
//
// Two of those four placements are read here, and they are the two this group
// can reach without driving anything but a pose: a card SQUARED on one of the
// top row's piles, and a card OVERLAPPED in a fanned column. A run in hand is
// reached only through a press, which this group does not make — the manifest's
// own header rules it out, because a broken grab rule would then be charged to
// `presentation` — and `presentation.held-run-drawn-above` decides it instead. A
// card in flight is drawn on the `won` screen by the victory cascade
// (specs/victory.md), and the `cascade` group decides where its flyers land.
//
// THE SECOND CHECK IS WHY THE COLUMN IS READ AS A COUNT OF ROWS. A card fanned
// under another shows only a band of itself, and a build that drew each covered
// card as that visible band rather than as a whole card would look identical
// while its footprint was wrong — until a card above it moved. Three cards on
// one column therefore have to leave THREE card-sized boxes at that column's x,
// however far apart the build spaced them; a build that drew the covered ones
// short leaves one. The spacing itself is `face-up-offset`'s, and nothing here
// asserts it.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
} from "../assert";
import {
  CARD_H,
  CARD_W,
  FOUNDATION_X,
  STOCK_X,
  TOP_ROW_Y,
  WASTE_X,
} from "../constants";
import {
  ACE,
  alternatingRun,
  captureStill,
  card,
  createHarness,
  down,
  KING,
  openTable,
  poseCard,
  poseColumn,
  poseWaste,
  SEVEN,
  THREE,
  type Harness,
} from "../harness";
import {
  boxesAt,
  busiestColumn,
  cardBoxes,
  corners,
  rowTops,
  tableauBoxes,
  type PlacedBox,
} from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140` and still be READ AS A
 * CARD at all, as a fraction of each side.
 *
 * A generous fifth, which is what every other point in this group uses to
 * identify a card. It is deliberately NOT the grading figure: a build that drew
 * its cards small has to be FOUND before it can be charged, and a filter tight
 * enough to grade would simply drop such a card out of the reading and fail this
 * point on the anchor instead of on the size.
 */
const CARD_LIKE_TOLERANCE = 0.2;

/**
 * How far a drawn card's extent may sit from `100 x 140` and still be said to
 * cover the footprint, in logical units.
 *
 * The allowance for a stroke traced down its centre-line: a build that draws its
 * card as a `strokeRect` two units wide inset to sit inside the footprint names
 * `98 x 138` and covers `100 x 140`. `specs/` fixes no line width, so two units
 * is the room this leaves, and it is the same two units every other `table` and
 * `presentation` point allows for the same reason. A build that sized its cards
 * wrongly at all misses by tens of units: the next plausible footprint down, a
 * card scaled to nine tenths, is `10` short across and `14` short down. The
 * `none` and `simple-2d` suites hold this item to the same two units.
 */
const SIZE_TOLERANCE = 2;

/**
 * How far a drawn card's top-left may sit from the anchor specs/table.md fixes
 * for it, in logical units.
 *
 * Every anchor in that file is a whole number in a space the harness maps
 * one-to-one onto the canvas at this window size, so a conformant build lands on
 * it exactly. One unit is the same snapping allowance as above.
 */
const ANCHOR_TOLERANCE = 1;

/**
 * How far two cards' left edges may differ and still be read as the same column,
 * in logical units.
 *
 * The fanned column is found as the group of card-sized boxes below the top row
 * that share a left edge and holds the most of them, so this decides which boxes
 * are grouped together and never where the group had to be: which x a column
 * stands at is `column-anchors`' point. The nearest column position is a pitch
 * away, `122` units, so one unit is snapping room and cannot merge two columns.
 */
const SAME_COLUMN_TOLERANCE = 1;

/**
 * How close two drawn top edges must be to count as one row, in logical units.
 *
 * A column's cards are never closer together than `FACE_UP_OFFSET_MIN` (`14`),
 * so two units can only ever merge one card's outline with its own fill and
 * never two different cards.
 */
const ROW_TOLERANCE = 2;

/** The column the fan is posed on: the one top-row position that carries no pile. */
const COLUMN = 2;

/** How many cards the fan holds. */
const FANNED = 3;

/**
 * How far the CLOSEST of a group of boxes sits from `100 x 140`, in logical
 * units — the larger of its two side errors.
 *
 * The closest, because a build is free to draw a card as several shapes (a fill
 * and a stroke, a rounded body and a border) and only one of them has to cover
 * the footprint.
 */
function deviation(boxes: readonly PlacedBox[]): number {
  return Math.min(
    ...boxes.map((box) =>
      Math.max(Math.abs(box.w - CARD_W), Math.abs(box.h - CARD_H)),
    ),
  );
}

/** The measured extents of a group of boxes, to a tenth of a unit, for a message. */
function extents(boxes: readonly PlacedBox[]): string {
  const round = (value: number) => Math.round(value * 10) / 10;
  return boxes.map((box) => `${round(box.w)} x ${round(box.h)}`).join(", ");
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a card over its whole footprint on each squared pile", async () => {
  openTable(h);
  poseCard(h, "stock", 0, down(card("spades", SEVEN)));
  poseWaste(h, [card("hearts", THREE)], [1]);
  poseCard(h, "foundation", 2, card("clubs", ACE));

  const calls = await h.drawFrame();
  captureStill(h, "card");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);

  const sites: readonly [string, number, number][] = [
    ["the card on the stock", STOCK_X, TOP_ROW_Y],
    ["the card the waste shows", WASTE_X, TOP_ROW_Y],
    ["the card on the third foundation", FOUNDATION_X[2], TOP_ROW_Y],
  ];
  for (const [name, x, y] of sites) {
    const at = boxesAt(boxes, x, y, ANCHOR_TOLERANCE);
    assertGreaterThan(
      at.length,
      0,
      `${name} drawn as a card-sized box at (${x}, ${y}); the frame drew ` +
        `card-like boxes at ${corners(boxes)}`,
    );
    assertLessThanOrEqual(
      deviation(at),
      SIZE_TOLERANCE,
      `how far the closest box drawn at (${x}, ${y}) sits from the ` +
        `${CARD_W} x ${CARD_H} footprint a card occupies wherever it sits, ` +
        `here ${name}; the boxes drawn there measured ${extents(at)} ` +
        "(specs/table.md)",
    );
  }
});

it("keeps the footprint of every card of a fanned column", async () => {
  openTable(h);
  poseColumn(h, COLUMN, alternatingRun(KING, FANNED));

  const calls = await h.drawFrame();
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);
  const column = busiestColumn(tableauBoxes(boxes), SAME_COLUMN_TOLERANCE);
  const rows = rowTops(column, ROW_TOLERANCE);

  assertGreaterThanOrEqual(
    rows.length,
    FANNED,
    `each of the ${FANNED} cards of the column drawn as a card-sized box; ` +
      `the frame drew the column's card-like boxes at ${corners(column)}`,
  );

  for (const top of rows) {
    const row = column.filter((box) => Math.abs(box.y - top) <= ROW_TOLERANCE);
    assertLessThanOrEqual(
      deviation(row),
      SIZE_TOLERANCE,
      `how far the closest box of the column's row at y = ${Math.round(top)} ` +
        `sits from the ${CARD_W} x ${CARD_H} footprint a card keeps even ` +
        `overlapped in a column; that row's boxes measured ${extents(row)} ` +
        "(specs/table.md)",
    );
  }
});
