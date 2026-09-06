// Shatter — saucer/enters-at-a-random-row: entry rows are drawn across the whole
// field, not taken from one lane.
//
// THE RULE. `specs/saucer.md`: a saucer enters "at a `y` drawn uniformly from
// `SAUCER_R` to `FIELD_H - SAUCER_R`", and "Entry rows are drawn across the whole
// field, so a crossing lined up on the star's row is an ordinary one."
//
// THE SPREAD ALONE. That every row lies INSIDE that range is
// `saucer/entry-row-inside-the-range`'s point, read off the same forty arrivals;
// this one reads only how far they spread. A build that always enters dead centre
// clears the range bound comfortably and fails here, which is exactly why the two
// are separate points.
//
// AND THE THRESHOLD IS DERIVED FROM THE STATED RANGE, NOT FROM AN OBSERVED SPREAD.
// The range is `684` units wide, and the forty rows must span more than half of
// it — `342` units. Forty draws from a uniform span less than half of it with
// probability `41 / 2^40`, under one in twenty billion, which is the
// specification's own claim about the draw and not a reference build's habit, and
// far beyond the six standard deviations a probability item is read to. A build
// entering on one fixed lane spans nothing at all, and one alternating between
// two lanes spans the gap between them.
//
// FORTY ARRIVALS OVER FOUR GAMES, so the reading covers LATER arrivals as well
// as first ones — four games, ten consecutive visits each. The gather is in
// `./rows`. `enters-at-an-edge` takes the other half of the entry draw, posed edge
// by edge.

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
 * Half the range the forty rows must span, `342` units.
 *
 * The item's own figure, and a property of the DRAW rather than of any build:
 * forty uniform samples span less than half their range once in twenty billion.
 * A build entering on one fixed lane spans nothing at all.
 */
const SPAN_NEEDED = (ROW_MAX - ROW_MIN) / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("spreads forty entry rows over more than half the range they are drawn from", async () => {
  const rows = await readEntryRows(h, "rows");
  const ys = rows.map((row) => row.y);

  assertGreaterThan(
    Math.max(...ys) - Math.min(...ys),
    SPAN_NEEDED,
    `the range ${rows.length} entry rows covered, against half the ` +
      `${ROW_MAX - ROW_MIN}-unit range they are drawn from (specs/saucer.md)`,
  );
});
