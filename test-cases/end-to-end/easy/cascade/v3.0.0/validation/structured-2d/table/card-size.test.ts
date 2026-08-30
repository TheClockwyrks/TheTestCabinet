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
import { FOUNDATION_X, STOCK_X, TOP_ROW_Y, WASTE_X } from "../../src/constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
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
} from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140`, as a fraction of each
 * side, and still be a card's footprint: one per cent, which is a unit across
 * and a unit and a half down.
 *
 * `CARD_W x CARD_H` is an exact figure, so this is rounding room and nothing
 * else — it covers a build that snaps its drawing to whole device pixels and
 * excludes anything drawn at a different size. This is the one point in the
 * group that reads the footprint itself, so it is the one that states a
 * tolerance this tight; the rest identify a card far more loosely, so that a
 * build which drew its cards small is charged here and nowhere else.
 */
const CARD_FOOTPRINT_TOLERANCE = 0.01;

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
  const boxes = cardBoxes(h, calls, CARD_FOOTPRINT_TOLERANCE);

  const sites: readonly [string, number, number][] = [
    ["the card on the stock", STOCK_X, TOP_ROW_Y],
    ["the card the waste shows", WASTE_X, TOP_ROW_Y],
    ["the card on the third foundation", FOUNDATION_X[2], TOP_ROW_Y],
  ];
  for (const [name, x, y] of sites) {
    assertGreaterThan(
      boxesAt(boxes, x, y, ANCHOR_TOLERANCE).length,
      0,
      `${name} drawn as a 100 x 140 box at (${x}, ${y}); the frame drew ` +
        `card-sized boxes at ${corners(boxes)}`,
    );
  }
});

it("keeps the footprint of every card of a fanned column", async () => {
  openTable(h);
  poseColumn(h, COLUMN, alternatingRun(KING, FANNED));

  const calls = await h.drawFrame();
  const boxes = cardBoxes(h, calls, CARD_FOOTPRINT_TOLERANCE);
  const column = busiestColumn(tableauBoxes(boxes), SAME_COLUMN_TOLERANCE);
  const rows = rowTops(column, ROW_TOLERANCE);

  assertGreaterThanOrEqual(
    rows.length,
    FANNED,
    `each of the ${FANNED} cards of the column drawn as a 100 x 140 box; ` +
      `the frame drew the column's card-sized boxes at ${corners(column)}`,
  );
});
