// table/compression-uniform — a compressed column's face-up gaps are all equal.
//
// THE RULE. specs/table.md reduces the offset "uniformly, THE SAME VALUE UNDER
// EVERY FACE-UP CARD OF THAT COLUMN, to the largest value that fits the column
// above the line". So compression is one number per column, not a per-card
// adjustment: a build that squeezed the last few cards to make the column fit, or
// that tightened progressively down the fan, draws a column that fits and still
// does not draw the column the specification describes.
//
// THE SCENARIO IS THE SAME THIRTEEN-CARD RUN `table/column-compression` uses, and
// deliberately so: the two points read the one arrangement in two directions, so a
// build that fits the column unevenly fails this and passes that, and a build that
// spaces evenly and never fits fails that and passes this.
//
// WHAT IS ASSERTED IS THE SPREAD, the largest gap less the smallest, and not any
// gap's value. Which value a compressed column owes is
// `table/column-compression`'s line and `table/compression-floor`'s floor; a
// column drawn evenly at some other spacing is uniform, and it is graded there.
//
// EVERY CARD IS FACE-UP, so every gap in the column is a face-up gap and the
// spread reads what the rule names. What compression does to a face-down gap is
// `table/compression-spares-face-down`.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  openTable,
  poseColumn,
  RANK_LABELS,
  type Harness,
} from "../harness";
import { drawnColumnGaps } from "./geometry";

/**
 * How far the largest face-up gap may sit above the smallest, in logical units.
 *
 * "The same value under every face-up card" leaves no spread at all, so this is
 * only the rounding a build is entitled to: a build that lays each card on a whole
 * logical unit turns a fitted offset of `29.67` into gaps of `29` and `30`, a
 * spread of one, and the stroke it insets inside its footprint can cost another.
 * A build that squeezes part of a column instead of all of it spreads its gaps by
 * the difference between `34` and whatever it squeezed to — units, not fractions.
 */
const SPREAD_TOLERANCE = 2;

/** The column the run is posed on. */
const COLUMN = 5;

/** Thirteen face-up spades, King down to Ace: a full run, all face-up. */
const CARDS = [...RANK_LABELS].reverse().map((label) => `${label}S`);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("draws every face-up gap of a compressed column at the same size", async () => {
  openTable(harness);
  poseColumn(harness, COLUMN, CARDS);

  const calls = await drawFrame(harness);
  captureStill(harness, "compressed");

  const gaps = drawnColumnGaps(harness, calls);
  assertLength(
    gaps,
    CARDS.length - 1,
    `gaps drawn in the column, which was posed with ${CARDS.length} cards`,
  );

  assertLessThanOrEqual(
    Math.max(...gaps) - Math.min(...gaps),
    SPREAD_TOLERANCE,
    `the spread of the ${gaps.length} face-up gaps of a compressed column, ` +
      `which the fit reduces uniformly (specs/table.md); the gaps drawn were ` +
      `${gaps.map((gap) => Math.round(gap * 100) / 100).join(", ")}`,
  );
});
