// saucer/enters-at-a-random-row — arrivals are spread across the field's height
// rather than lined up on one lane.
//
// THE RULE. `specs/saucer.md`, Entry and travel: a saucer enters "at a `y` drawn
// uniformly from `SAUCER_R` to `FIELD_H - SAUCER_R`", and "Entry rows are drawn
// across the whole field, so a crossing lined up on the star's row is an ordinary
// one."
//
// THE SPREAD ALONE. That every row lies INSIDE that range is
// `saucer/entry-row-inside-the-range`'s point, read off the same forty arrivals;
// this one reads only how far they spread. A build that always enters dead centre
// clears the range bound comfortably and fails here, which is exactly why the two
// are separate points.
//
// THE SPREAD THRESHOLD IS DERIVED FROM THE STATED RANGE, NOT FROM AN OBSERVED ONE.
// The range `specs/saucer.md` fixes is `[SAUCER_R, FIELD_H - SAUCER_R]`, which is
// `684` units wide, and the forty rows are required to span more than half of it
// — `342` units. A uniform draw clears that overwhelmingly: forty uniform draws
// span less than half their range with probability `41 / 2^40`, under one in
// twenty billion, far beyond the six standard deviations a probability item is
// read to, while a build that always enters on the star's row, or on one of two
// fixed lanes, spans nothing and fails. Reading the threshold off a reference run
// instead would have made it a fact about that build.
//
// FORTY ARRIVALS OVER FOUR GAMES, ten apiece: the draw is the game's own, so the
// sample has to come from games that were really opened and left to run, each
// arrival brought on with a posed due once the visit before it has ended. The
// gather is in `./rows`.
//
// WHAT THIS DOES NOT DECIDE. The side a saucer comes in at
// (`saucer/enters-at-an-edge`), the row bound
// (`saucer/entry-row-inside-the-range`), or that the row is redrawn per arrival
// rather than per game — the spread over forty arrivals from four games is what
// stands in for that, and no stronger statement is available without asserting a
// distribution the specification does not fix.

import { afterEach, it } from "vitest";
import { FIELD_H, SAUCER_R } from "../constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { type Harness } from "../harness";
import { ARRIVALS, ARRIVALS_PER_GAME, GAMES, readEntryRows } from "./rows";

/** The row range `specs/saucer.md` draws an entry from. */
const ROW_MIN = SAUCER_R;
const ROW_MAX = FIELD_H - SAUCER_R;

/**
 * The least the forty rows may span, in units: half the stated range. See the
 * header for the derivation.
 */
const MIN_SPAN = (ROW_MAX - ROW_MIN) / 2;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("spreads forty entry rows over more than half the range they are drawn from", async () => {
  const rows = await readEntryRows(harnesses, "rows");

  assertGreaterThanOrEqual(
    rows.length,
    ARRIVALS,
    `arrivals produced by ${GAMES} games of ${ARRIVALS_PER_GAME} posed dues ` +
      "with the game's own saucer arrival running (specs/saucer.md, The cadence)",
  );

  const ys = rows.map((row) => row.y);
  assertGreaterThan(
    Math.max(...ys) - Math.min(...ys),
    MIN_SPAN,
    `the span of ${rows.length} entry rows, against half the ` +
      `${ROW_MAX - ROW_MIN}-unit range specs/saucer.md draws them uniformly ` +
      `from — a build entering on one fixed lane spans nothing`,
  );
});
