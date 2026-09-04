// Cascade — table/column-anchors: the seven columns stand at the seven x
// positions `COLUMN_X` fixes, and the gaps between them carry nothing.
//
// specs/table.md, Column anchors: "The seven columns are evenly spaced, at a
// pitch of `122`, which is a `100`-wide card and a `22` gap. `COLUMN_X` holds
// their left edges" — `224`, `346`, `468`, `590`, `712`, `834`, `956` — and "The
// gaps between the columns carry no pile and nothing card-sized is drawn in
// them."
//
// BOTH HALVES ARE READ, and they fail differently. A build that spaced its
// columns at some other pitch misses the anchors; a build that spaced them
// correctly but drew a card wider than its footprint, or drew a second card
// beside each column, puts something card-sized in a gap. The second reading is
// what makes the first more than a spot check: seven boxes at seven x positions
// says nothing about what else the frame painted between them.
//
// THE READING IS x ALONE. Which y a column starts at is `tableau-anchor-y`'s
// point, so a card-sized box at a column's x counts here wherever down the table
// it was drawn, as long as it is below the top row. The top row and the tableau
// are separated by the specification itself — "The top row's rectangles end at
// `y = 164` and the columns' begin at `y = 180`" — and the separation matters
// because the stock, the waste and the four foundations sit at six of these same
// seven x positions, so an empty pile's mark up there would otherwise answer for
// a column.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  CARD_H,
  CARD_W,
  COLUMN_X,
  TABLEAU_COLUMNS,
  TOP_ROW_Y,
} from "../constants";
import {
  alternatingRun,
  captureStill,
  COLUMNS,
  createHarness,
  KING,
  openTable,
  poseCard,
  type Harness,
} from "../harness";
import { boxesAtX, cardBoxes, corners } from "./placed";

/**
 * How far a drawn box's size may sit from `100 x 140`, as a fraction of each
 * side, and still be READ as a card.
 *
 * This is identification and not a requirement: it is how this check picks the
 * cards out of a frame that also drew pips, ranks, the felt and the HUD strip,
 * and it is deliberately loose so that the ONE point about the footprint,
 * `card-size`, is the one that decides it. A build that drew every card a few
 * units small has its anchors read here exactly like any other. A fifth of each
 * side is far wider than a defect of that kind and far narrower than anything
 * else this game puts on the table.
 */
const CARD_LIKE_TOLERANCE = 0.2;

/**
 * How far a drawn card's left edge may sit from the `COLUMN_X` entry it belongs
 * to, in logical units. The anchors are whole numbers in a space that maps
 * one-to-one onto the canvas here, so a conformant build lands on them exactly.
 */
const ANCHOR_TOLERANCE = 1;

/**
 * The band of each gap a card's left edge is forbidden from, in logical units.
 *
 * The gap between two columns runs `22` units, from a column's right edge to the
 * next column's anchor. {@link ANCHOR_TOLERANCE} is taken off each end, so a
 * build that landed a unit either side of an anchor is not read as having drawn
 * in the gap, and the twenty units left over are gap and nothing else.
 */
const GAP_MARGIN = ANCHOR_TOLERANCE;

/** Where the top row's own footprint ends (specs/table.md). */
const TOP_ROW_BOTTOM = TOP_ROW_Y + CARD_H;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws one card on each column at that column's own anchor", async () => {
  openTable(h);
  const cards = alternatingRun(KING, TABLEAU_COLUMNS);
  COLUMNS.forEach((column) => poseCard(h, "tableau", column, cards[column]));

  const calls = await h.drawFrame();
  captureStill(h, "columns");
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);
  const tableau = boxes.filter((box) => box.y > TOP_ROW_BOTTOM);

  for (const column of COLUMNS) {
    assertGreaterThan(
      boxesAtX(tableau, COLUMN_X[column], ANCHOR_TOLERANCE).length,
      0,
      `the card on column ${column} drawn with its left edge at x = ` +
        `${COLUMN_X[column]}; below the top row the frame drew card-sized ` +
        `boxes at ${corners(tableau)}`,
    );
  }
});

it("draws nothing card-sized in the gaps between the columns", async () => {
  openTable(h);
  const cards = alternatingRun(KING, TABLEAU_COLUMNS);
  COLUMNS.forEach((column) => poseCard(h, "tableau", column, cards[column]));

  const calls = await h.drawFrame();
  const boxes = cardBoxes(h, calls, CARD_LIKE_TOLERANCE);

  for (let column = 0; column + 1 < TABLEAU_COLUMNS; column += 1) {
    const from = COLUMN_X[column] + CARD_W;
    const to = COLUMN_X[column + 1];
    const inside = boxes.filter(
      (box) => box.x > from + GAP_MARGIN && box.x < to - GAP_MARGIN,
    );
    assertEqual(
      inside.length,
      0,
      `card-sized boxes drawn in the ${to - from}-unit gap between column ` +
        `${column} and column ${column + 1}, which runs x ${from} to ${to}; ` +
        `they were drawn at ${corners(inside)}`,
    );
  }
});
