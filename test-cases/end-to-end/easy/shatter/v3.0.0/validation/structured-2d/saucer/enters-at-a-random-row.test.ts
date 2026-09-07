// saucer/enters-at-a-random-row — arrivals are not lined up on one lane.
//
// THE RULE. `specs/saucer.md`, Entry and travel: a saucer enters "at a `y` drawn
// uniformly from `SAUCER_R` to `FIELD_H - SAUCER_R`", and "Entry rows are drawn
// across the whole field, so a crossing lined up on the star's row is an ordinary
// one."
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
// decides: it is the reviewer's to judge from the picture.
//
// TWO ROWS ARE DISTINCT WHEN THEY DIFFER BY MORE THAN A READING CAN. A saucer
// "enters with no vertical component" and its weave begins "one full interval
// after it enters", so its row stands for a whole second and the first marched
// sample reads it exactly; the allowance below is what a build that starts its
// weave on the tick of entry could move a row by before that sample, so such a
// build is failed by `saucer/weave-interval` rather than credited here with
// variation it never drew.
//
// SIX ARRIVALS OVER TWO GAMES, three apiece: the draw is the game's own, so the
// arrivals come from games that were really opened and left to run, each brought
// on with a posed due once the visit before it has ended. The gather is in
// `./rows`.
//
// WHAT THIS DOES NOT DECIDE. The side a saucer comes in at
// (`saucer/enters-at-an-edge`) or the row bound
// (`saucer/entry-row-inside-the-range`).

import { afterEach, it } from "vitest";
import { SAUCER_WEAVE_SPEED } from "../constants";
import { assertGreaterThan, assertGreaterThanOrEqual } from "../assert";
import { type Harness } from "../harness";
import { MARCH_STEP } from "./visits";
import { ARRIVALS, ARRIVALS_PER_GAME, GAMES, readEntryRows } from "./rows";

/**
 * How far apart two rows must be to count as two rows, in units.
 *
 * One marched frame of `SAUCER_WEAVE_SPEED` (`90`) — `6` units — the most a first
 * reading can be moved by a weave that began on the tick of entry. A build
 * entering on one fixed lane reads rows a full zero apart.
 */
const ROW_SLACK = SAUCER_WEAVE_SPEED * MARCH_STEP;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("enters at more than one row across six arrivals", async () => {
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
    ROW_SLACK,
    `the units between the highest and the lowest of ${rows.length} entry ` +
      "rows, which a row drawn afresh for every arrival puts apart and a fixed " +
      "lane never does (specs/saucer.md)",
  );
});
