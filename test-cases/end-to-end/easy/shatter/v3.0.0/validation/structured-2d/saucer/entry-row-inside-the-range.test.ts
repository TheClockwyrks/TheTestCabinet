// saucer/entry-row-inside-the-range — every entry row lies inside the range the
// specification draws it from.
//
// THE RULE. `specs/saucer.md`, Entry and travel: a saucer enters "at a `y` drawn
// uniformly from `SAUCER_R` to `FIELD_H - SAUCER_R`". The bound alone is this
// point's; that the rows also SPREAD across that range is
// `saucer/enters-at-a-random-row`'s, read off the same sixteen arrivals.
//
// THE BOUND IS THE RANGE ITSELF, not a tolerance around an observed one:
// `[SAUCER_R, FIELD_H - SAUCER_R]` is `[18, 702]`.
//
// WHICH WRONG MODEL THIS DECIDES, PLAINLY. It fails a build that puts a saucer
// where half the craft is off the field — most sharply one drawing over the whole
// `[0, FIELD_H]`, or clamping to `0`, or entering at a fixed `y` outside the band.
// It is worth saying what it only SOMETIMES catches: sixteen draws over `[0, 720]`
// each land outside `[18, 702]` with probability `36/720` = `1/20`, so sixteen of
// them catch that particular build about `56` percent of the time. Sixteen is what
// the spread half needs and what the arrivals cost; nothing here pretends the
// reading is a certainty against a draw that is only slightly too wide, and a build
// entering at `y = 0` on every arrival fails on the first one.
//
// THE ROW READING IS EXACT. A saucer "enters with no vertical component" and its
// weave begins "one full interval after it enters", so the row is unchanged for a
// whole second after the arrival — far longer than the one marched frame the first
// sample can be late by. The allowance below exists only so a build that starts its
// weave immediately is failed by `saucer/weave-interval` rather than here.
//
// SIXTEEN ARRIVALS UNDER FOUR SEEDS, four apiece, so the reading covers LATER
// arrivals as well as first ones. The gather is in `./rows`, shared with the spread
// item, and the range is asserted PER ARRIVAL so a build that enters off the field
// once fails on that one rather than being averaged out.

import { afterEach, it } from "vitest";
import { FIELD_H, SAUCER_R, SAUCER_WEAVE_SPEED } from "../constants";
import { assertBetween, assertGreaterThanOrEqual } from "../assert";
import { type Harness } from "../harness";
import { MARCH_STEP } from "./visits";
import { ARRIVALS, SEEDS, WATCH_SECONDS, readEntryRows } from "./rows";

/** The row range `specs/saucer.md` draws an entry from. */
const ROW_MIN = SAUCER_R;
const ROW_MAX = FIELD_H - SAUCER_R;

/**
 * How far outside that range a first reading may sit, in units.
 *
 * One marched frame of `SAUCER_WEAVE_SPEED` (`90`) — `6` units — which is the most
 * a build that begins weaving on the tick of entry could have moved before the
 * first sample. It is a reading allowance, not room on the range: the range is
 * `684` units wide and this is a hundredth of it.
 */
const ROW_SLACK = SAUCER_WEAVE_SPEED * MARCH_STEP;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("draws every entry row from inside [SAUCER_R, FIELD_H - SAUCER_R]", async () => {
  const rows = await readEntryRows(harnesses, "entry");

  assertGreaterThanOrEqual(
    rows.length,
    ARRIVALS,
    `arrivals produced by ${SEEDS.length} games of ${WATCH_SECONDS} s with the ` +
      "game's own saucer arrival running (specs/saucer.md, The cadence)",
  );

  for (const row of rows) {
    assertBetween(
      row.y,
      ROW_MIN - ROW_SLACK,
      ROW_MAX + ROW_SLACK,
      `the entry row of saucer ${row.id} (seed ${row.seed}) against the ` +
        `[SAUCER_R, FIELD_H - SAUCER_R] = [${ROW_MIN}, ${ROW_MAX}] a saucer's ` +
        "y is drawn uniformly from (specs/saucer.md)",
    );
  }
});
