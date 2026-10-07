// Shatter — saucer/enters-at-a-random-row: entry rows are drawn across the whole
// field, not taken from one lane.
//
// THE RULE. `specs/saucer.md`: a saucer enters "at a `y` drawn uniformly from
// `SAUCER_R` to `FIELD_H - SAUCER_R`", and "Entry rows are drawn across the whole
// field, so a crossing lined up on the star's row is an ordinary one."
//
// THE VARIATION ALONE. That every row lies INSIDE that range is
// `saucer/entry-row-inside-the-range`'s point, read off the same six arrivals;
// this one reads only that the rows are not all one row. A build that always
// enters dead centre clears the range bound comfortably and fails here, which is
// exactly why the two are separate points.
//
// TWO DISTINCT ROWS ARE THE WHOLE OF THE ASSERTION. The draw is continuous, so
// six arrivals from it never share a row, while a build that enters on one fixed
// lane reads six copies of one number and fails. How widely a build's rows spread
// inside the range is not a figure `specs/saucer.md` fixes and not one a sample
// decides: it is the reviewer's to judge from the picture. Two rows are distinct
// when they differ by more than the float slack a uniform draw over
// whole-numbered ends can carry, which is the same half unit the range item
// allows at its ends.
//
// SIX ARRIVALS OVER TWO GAMES, so the reading covers LATER arrivals as well as
// first ones — two games, three consecutive visits each. The gather is in
// `./rows`. `enters-at-an-edge` takes the other half of the entry draw, posed
// edge by edge.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { createHarness, type Harness } from "../harness";
import { readEntryRows } from "./rows";

/**
 * How far apart two rows must be to count as two rows: half a unit.
 *
 * Float rounding on a uniform draw over a range whose ends are whole numbers, and
 * nothing else. A build entering on one fixed lane reads rows a full zero apart.
 */
const ROW_EPSILON = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("enters at more than one row across six arrivals", async () => {
  const rows = await readEntryRows(h, "rows");
  const ys = rows.map((row) => row.y);

  assertGreaterThan(
    Math.max(...ys) - Math.min(...ys),
    ROW_EPSILON,
    `the units between the highest and the lowest of ${rows.length} entry ` +
      "rows, which a row drawn afresh for every arrival puts apart and a fixed " +
      "lane never does (specs/saucer.md)",
  );
});
