// table/compression-uniform — a compressed column's face-up gaps are all equal.
//
// THE RULE. `specs/table.md`: a column that would pass the line has "its face-up
// offset … reduced uniformly, the same value under every face-up card of that
// column, to the largest value that fits the column above the line". One value,
// under every face-up card — not a fan that tightens as it descends, and not a
// column left at `34` down to the last few cards that are then squeezed.
//
// THE POSE. Column 2 — the one column anchor no top-row pile shares — carrying
// fifteen face-up cards. Every gap in that column is then a face-up gap, so the
// reading needs no bookkeeping about which gap is which, and the column is well
// into the compressed case: `796` natural against a `676` line, fitted to
// fourteen gaps of `25.43`.
//
// The demanded offset sits between the floor (`14`) and the natural offset
// (`34`), so the two uniform models that are simply WRONG — a build that never
// compresses and a build that always draws the floor — are uniform too and are
// docked at `table/column-compression` and `table/face-up-offset` instead. What
// this point catches is the model that is not uniform at all.
//
// WHAT IS READ. The spread of the fourteen gaps: the largest less the smallest.
// A tail-squeezing build leaves most gaps at `34` and the last few far under it,
// and a progressively tightening fan spreads over the whole range; either way the
// spread is many units. The value the gaps agree ON is not read here, because
// that is what the two points above decide.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import { COLUMN_X } from "../constants";
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
 * Fifteen face-up cards, so every one of the fourteen gaps is a face-up gap and
 * the column is compressed to `25.43` from a natural `34`.
 */
const CARDS = 15;

/**
 * How far a painted shape's size may sit from the card footprint, and its left
 * edge from the column's anchor, to be read as one of that column's cards, in
 * logical units: room for the unit a build loses insetting a stroke, on a
 * footprint `table/card-size` grades.
 */
const CARD_SIZE_TOLERANCE = 2;

/**
 * How far the widest gap may exceed the narrowest and still be called uniform, in
 * logical units.
 *
 * The offset the fit demands here is `25.428…`, and `specs/table.md` fixes no
 * rounding, so a build that lays its rows on whole units draws gaps that differ
 * by one — `25` and `26` alternating. Two units is that whole unit with the
 * reading's own noise around it, and it is far under what a build that is not
 * uniform produces: the smallest non-uniform model that still fits the column
 * above the line leaves some gaps at the natural `34`, eight units clear of the
 * `25.43` the rest would have to take.
 */
const SPREAD_TOLERANCE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every face-up gap of a compressed column the same size", async () => {
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

  const gaps = rows.slice(1).map((y, index) => y - rows[index]);
  assertLessThanOrEqual(
    Math.max(...gaps) - Math.min(...gaps),
    SPREAD_TOLERANCE,
    `the spread of the ${gaps.length} face-up gaps of a compressed column of ` +
      `${CARDS} face-up cards, which specs/table.md reduces uniformly to the ` +
      "same value under every face-up card; the gaps drawn were " +
      gaps.map((gap) => Math.round(gap * 100) / 100).join(", "),
  );
});
