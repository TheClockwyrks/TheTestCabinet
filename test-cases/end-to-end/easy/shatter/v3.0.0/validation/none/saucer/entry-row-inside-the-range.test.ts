// Shatter — saucer/entry-row-inside-the-range: every entry row lies inside the
// range the specification draws it from.
//
// THE RULE. `specs/saucer.md`: a saucer enters "at a `y` drawn uniformly from
// `SAUCER_R` to `FIELD_H - SAUCER_R`". The bound alone is this point's; that the
// rows also VARY across that range is `saucer/enters-at-a-random-row`'s, read off
// the same six arrivals.
//
// THE BOUND IS THE RANGE ITSELF, not a tolerance around an observed one:
// `[SAUCER_R, FIELD_H - SAUCER_R]` is `[18, 702]`, and half a unit of float slack is
// allowed on each end for a uniform draw over whole-numbered ends. A build drawing
// from a wider range misses by units, not by halves.
//
// WHICH WRONG MODEL THIS DECIDES, PLAINLY. It fails a build that puts a saucer
// where half the craft is off the field — most sharply one clamping to `0`, or
// entering at a fixed `y` outside the band, which fails on the first arrival. A
// build whose range is only slightly too wide lands outside the band on a
// fraction of its draws, and six arrivals are a handful rather than a sample:
// they decide that the rows a build draws lie where the specification puts them,
// and leave how a build's draw is shaped to the reviewer.
//
// SIX ARRIVALS OVER TWO GAMES, three apiece, so the reading covers LATER arrivals
// as well as first ones. The gather is in `./rows`, shared with the variation
// item, and the range is asserted PER ARRIVAL so a build that enters off the
// field once fails on that one rather than being averaged out.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { FIELD_H, SAUCER_R } from "../constants";
import { createHarness, type Harness } from "../harness";
import { readEntryRows } from "./rows";

/** The bottom of the range `specs/saucer.md` draws the entry row from. */
const ROW_MIN = SAUCER_R;

/** The top of it. */
const ROW_MAX = FIELD_H - SAUCER_R;

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

it("draws every entry row from inside the stated range", async () => {
  const rows = await readEntryRows(h, "entry");

  for (const row of rows) {
    assertBetween(
      row.y,
      ROW_MIN - ROW_EPSILON,
      ROW_MAX + ROW_EPSILON,
      `the entry row of saucer ${row.id} (game ${row.game + 1}) against the ` +
        `[SAUCER_R, FIELD_H - SAUCER_R] = [${ROW_MIN}, ${ROW_MAX}] a saucer's y ` +
        "is drawn uniformly from (specs/saucer.md)",
    );
  }
});
