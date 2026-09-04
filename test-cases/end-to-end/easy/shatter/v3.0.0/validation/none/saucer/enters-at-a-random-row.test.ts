// Shatter — saucer/enters-at-a-random-row: entry rows are drawn across the whole
// field, not taken from one lane.
//
// THE RULE. `specs/saucer.md`: a saucer enters "at a `y` drawn uniformly from
// `SAUCER_R` to `FIELD_H - SAUCER_R`", and "Entry rows are drawn across the whole
// field, so a crossing lined up on the star's row is an ordinary one."
//
// THE SPREAD ALONE. That every row lies INSIDE that range is
// `saucer/entry-row-inside-the-range`'s point, read off the same sixteen arrivals;
// this one reads only how far they spread. A build that always enters dead centre
// clears the range bound comfortably and fails here, which is exactly why the two
// are separate points.
//
// AND THE THRESHOLD IS DERIVED FROM THE STATED RANGE, NOT FROM AN OBSERVED SPREAD.
// The range is `684` units wide, and the sixteen rows must span more than half of
// it — `342` units. Sixteen draws from a uniform span less than half of it with
// probability under one in two thousand, which is the specification's own claim
// about the draw and not a reference build's habit. A build entering on one fixed
// lane spans nothing at all, and one alternating between two lanes spans the gap
// between them.
//
// SIXTEEN ARRIVALS UNDER FOUR SEEDS, so the reading covers LATER arrivals as well
// as first ones — four games, four consecutive visits each. The gather is in
// `./rows`. `enters-at-an-edge` takes the other half of the entry draw off first
// arrivals alone, and between them both halves are read on both.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { FIELD_H, SAUCER_R } from "../constants";
import { createHarness, type Harness } from "../harness";
import { readEntryRows } from "./rows";

/** The bottom of the range `specs/saucer.md` draws the entry row from. */
const ROW_MIN = SAUCER_R;

/** The top of it. */
const ROW_MAX = FIELD_H - SAUCER_R;

/**
 * Half the range the sixteen rows must span, `342` units.
 *
 * The item's own figure, and a property of the DRAW rather than of any build:
 * sixteen uniform samples span less than half their range about five times in ten
 * thousand. A build entering on one fixed lane spans nothing at all.
 */
const SPAN_NEEDED = (ROW_MAX - ROW_MIN) / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spreads sixteen entry rows over more than half the range they are drawn from", async () => {
  const rows = await readEntryRows(h, "rows");
  const ys = rows.map((row) => row.y);

  assertGreaterThan(
    Math.max(...ys) - Math.min(...ys),
    SPAN_NEEDED,
    `the range ${rows.length} entry rows covered, against half the ` +
      `${ROW_MAX - ROW_MIN}-unit range they are drawn from (specs/saucer.md)`,
  );
});
