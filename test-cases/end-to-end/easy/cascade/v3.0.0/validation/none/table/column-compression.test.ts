// table/column-compression — a long column is fitted above the 676 line.
//
// THE RULE. `specs/table.md`: "A column's lowest card's bottom edge may not fall
// below `COLUMN_BOTTOM_LIMIT` (`676`). When a column's natural extent at the
// offsets above would pass that line, its face-up offset is reduced uniformly …
// to the largest value that fits the column above the line."
//
// THE POSE, AND WHY FIFTEEN CARDS. Column 2 — the one column anchor no top-row
// pile shares, so every card-sized shape at `x = 468` is that column's — carrying
// fifteen face-up cards. At the natural `FACE_UP_OFFSET` (`34`) those fifteen
// reach a top edge of `180 + 34 x 14 = 656` and a bottom edge of `796`, which is
// `120` units past the line, so the column is squarely in the case the rule names
// and a build that simply does not compress overruns by a distance no tolerance
// could absorb. Fitted, the fourteen gaps are `356 / 14 = 25.43` and the lowest
// card's bottom edge lands exactly on `676`.
//
// Fifteen rather than more: the demanded offset stays well clear of
// `FACE_UP_OFFSET_MIN` (`14`), so this reads the fitting rule and not the floor,
// which is `table/compression-floor`.
//
// WHAT IS READ, AND IN WHICH DIRECTION. The lowest row the column drew, plus a
// card's height, against `676`. That is the whole of what the rule states about
// the extent, and it is one-directional on purpose: a build that compressed
// harder than it had to still fits above the line and is not charged here.
// Whether it compressed EVENLY is `table/compression-uniform`, and whether it
// left the face-down gaps alone is `table/compression-spares-face-down`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  CARD_H,
  COLUMN_BOTTOM_LIMIT,
  COLUMN_X,
  FACE_UP_OFFSET,
  TABLEAU_Y,
} from "../constants";
import {
  captureStill,
  columnOfCards,
  columnRowTops,
  createHarness,
  openTable,
  poseColumn,
  type Harness,
} from "../harness";

/** The column posed: the one anchor no top-row pile shares (`468`). */
const COLUMN = 2;

/**
 * Fifteen face-up cards: enough that the natural extent, `796`, passes
 * `COLUMN_BOTTOM_LIMIT` by `120` units, and few enough that the offset the fit
 * demands (`25.43`) stays well above the floor of `14`.
 */
const CARDS = 15;

/**
 * How far a painted shape's size may sit from the card footprint, and its left
 * edge from the column's anchor, to be read as one of that column's cards, in
 * logical units: room for the unit a build loses insetting a stroke, on a
 * footprint `table/card-size` grades. It is well under the `25.43` this column's
 * gaps come to, so two cards are never merged into one row.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far past the line the lowest card's bottom edge may sit, in logical units.
 *
 * `specs/table.md` fixes no rounding for the reduced offset, which here is
 * `25.428…`, so a build that rounds each row's `y` up to whole units carries its
 * lowest card at most a unit low; one unit is that. A build that did not compress
 * at all overruns by `120`.
 */
const OVERRUN_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps the lowest card of a long column above 676", async () => {
  await openTable(h);
  await poseColumn(h, COLUMN, columnOfCards(CARDS));

  const calls = await h.frameCalls();
  await captureStill(h, "compressed");

  const rows = columnRowTops(calls, COLUMN, CARD_SIZE_TOLERANCE);
  assertLength(
    rows,
    CARDS,
    `rows the ${CARDS} cards on column ${COLUMN} were drawn on, read as the ` +
      `distinct top edges of the card-sized shapes at x = ${COLUMN_X[COLUMN]}` +
      " (specs/table.md)",
  );

  const natural = TABLEAU_Y + FACE_UP_OFFSET * (CARDS - 1) + CARD_H;
  assertLessThanOrEqual(
    rows[rows.length - 1] + CARD_H,
    COLUMN_BOTTOM_LIMIT + OVERRUN_TOLERANCE,
    `the bottom edge of the lowest card of a column of ${CARDS} face-up cards, ` +
      `which would reach ${natural} at the natural offset of ${FACE_UP_OFFSET} ` +
      `and may not fall below COLUMN_BOTTOM_LIMIT (${COLUMN_BOTTOM_LIMIT}) ` +
      "(specs/table.md)",
  );
});
