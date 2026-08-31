// Shatter — saucer/enters-at-a-random-row: entry rows are drawn across the whole
// field, not taken from one lane.
//
// THE RULE. `specs/saucer.md`: a saucer enters "at a `y` drawn uniformly from
// `SAUCER_R` to `FIELD_H - SAUCER_R`", and "Entry rows are drawn across the whole
// field, so a crossing lined up on the star's row is an ordinary one."
//
// TWO READINGS OFF ONE SET OF ARRIVALS, BOTH OFF THE STATED RANGE. Every row lies
// inside `[SAUCER_R, FIELD_H - SAUCER_R]` — the range the specification names, so a
// build that enters half a craft off the field fails — and the sixteen rows span
// more than HALF of that range. The second is what a build entering on one fixed
// lane fails, and the threshold is derived from the range rather than from any
// observed spread: sixteen draws from a uniform span less than half of it with
// probability under one in two thousand, which is the specification's own claim
// about the draw and not a reference build's habit.
//
// SIXTEEN ARRIVALS UNDER FOUR SEEDS, so the reading covers LATER arrivals as well
// as first ones — four games, four consecutive visits each. `enters-at-an-edge`
// takes the other half of the entry draw off first arrivals alone, and between them
// both halves are read on both.
//
// A COARSE STRIDE COSTS THIS READING NOTHING, which is why the arrivals are caught
// with one. `specs/saucer.md` has the saucer enter "with no vertical component" and
// reroll its weave "every `SAUCER_WEAVE_INTERVAL`, STARTING ONE FULL INTERVAL after
// it enters", so the row a saucer entered on is still the row it is on for a whole
// second afterwards — and the stride below is half of that second at its widest.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertGreaterThan } from "../assert";
import { FIELD_H, SAUCER_R, TICK_HZ } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { nextArrival, openSaucerGame } from "./cadence";

/** The four games the arrivals are read from. */
const SEEDS = [1, 2, 3, 4] as const;

/** How many consecutive visits are read from each of them. Four each, sixteen in all. */
const ARRIVALS_PER_SEED = 4;

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

/**
 * Half a `SAUCER_WEAVE_INTERVAL`, the stride the arrivals are caught with.
 *
 * Not a tolerance: the entry row holds for a full interval after the saucer enters
 * (see the header), so a stride inside that reads the row exactly.
 */
const STRIDE = TICK_HZ / 2;

/**
 * The slack allowed on the ends of the stated range: half a unit.
 *
 * Float rounding on a uniform draw over a range whose ends are whole numbers, and
 * nothing else. A build drawing from a wider range misses by units, not by halves.
 */
const ROW_EPSILON = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every entry row from the stated range and spans more than half of it", async () => {
  const rows: number[] = [];

  for (const seed of SEEDS) {
    await openSaucerGame(h, seed);
    let previous: number | null = null;
    for (let visit = 0; visit < ARRIVALS_PER_SEED; visit += 1) {
      const arrival = await nextArrival(h, previous, { stride: STRIDE });
      if (rows.length === 0) await captureStill(h, "rows");
      rows.push(arrival.saucer.y);
      previous = arrival.saucer.id;
    }
  }

  for (const row of rows) {
    assertBetween(
      row,
      ROW_MIN - ROW_EPSILON,
      ROW_MAX + ROW_EPSILON,
      "an entry row inside the range specs/saucer.md draws it from",
    );
  }

  assertGreaterThan(
    Math.max(...rows) - Math.min(...rows),
    SPAN_NEEDED,
    `the range ${rows.length} entry rows covered, against half the range they are drawn from (specs/saucer.md)`,
  );
});
