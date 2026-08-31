// saucer/enters-at-a-random-row — arrivals are spread across the field's height
// rather than lined up on one lane.
//
// THE RULE. `specs/saucer.md`, Entry and travel: a saucer enters "at a `y` drawn
// uniformly from `SAUCER_R` to `FIELD_H - SAUCER_R`". Two things follow, and this
// point asserts both because they are the same rule read twice: every row is
// INSIDE that range, and sixteen draws from it SPREAD across it.
//
// THE SPREAD THRESHOLD IS DERIVED FROM THE STATED RANGE, NOT FROM AN OBSERVED ONE.
// The range `specs/saucer.md` fixes is `[SAUCER_R, FIELD_H - SAUCER_R]`, which is
// `684` units wide, and the sixteen rows are required to span more than half of it
// — `342` units. A uniform draw clears that overwhelmingly (sixteen uniform draws
// span more than half their range unless every one of them lands in the same half,
// which is about one run in a thousand), while a build that always enters on the
// star's row, or on one of two fixed lanes, spans nothing and fails. Reading the
// threshold off a reference run instead would have made it a fact about that build.
//
// SIXTEEN ARRIVALS UNDER FOUR SEEDS, four apiece: the draw is the game's own, so
// the sample has to come from games that were really opened and left to run. The
// range is asserted PER ARRIVAL and the span over the whole set, so a build that
// enters off the field once fails on that one rather than being averaged out.
//
// THE ROW READING IS EXACT. A saucer "enters with no vertical component" and its
// weave begins "one full interval after it enters", so the row is unchanged for a
// whole second after the arrival — far longer than the one marched frame the first
// sample can be late by. The allowance below exists only so a build that starts
// its weave immediately is failed by `saucer/weave-interval` rather than here.
//
// WHAT THIS DOES NOT DECIDE. The side it comes in at
// (`saucer/enters-at-an-edge`), or that the row is redrawn per arrival rather than
// per game — the spread over sixteen arrivals from four seeds is what stands in
// for that, and no stronger statement is available without asserting a
// distribution the specification does not fix.

import { afterEach, it } from "vitest";
import { FIELD_H, SAUCER_R, SAUCER_WEAVE_SPEED } from "../../src/constants";
import {
  assertBetween,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import { captureStill, type Harness } from "../harness";
import {
  createMarchHarness,
  MARCH_STEP,
  marchFrames,
  openQuietGame,
  watchVisits,
} from "./visits";

/** The four seeds the rows are drawn under. */
const SEEDS = [1, 2, 3, 4] as const;

/** How many arrivals each seed contributes. */
const ARRIVALS_PER_SEED = 4;

/** The sixteen arrivals the point is decided on. */
const ARRIVALS = SEEDS.length * ARRIVALS_PER_SEED;

/**
 * How long each seed's game is watched, in seconds of game time.
 *
 * Four arrivals at their slowest legal cadence is `18 + 3 x (12 + 35)` = `159` s;
 * `170` leaves margin, so a build that never produces four is reported as that
 * rather than as a bad row.
 */
const WATCH_SECONDS = 170;

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

/**
 * The least the sixteen rows may span, in units: half the stated range. See the
 * header for the derivation.
 */
const MIN_SPAN = (ROW_MAX - ROW_MIN) / 2;

let harnesses: Harness[] = [];

afterEach(() => {
  for (const h of harnesses) h.dispose();
  harnesses = [];
});

it("draws every entry row inside [SAUCER_R, FIELD_H - SAUCER_R] and spreads sixteen of them over half of it", async () => {
  const rows: { seed: number; id: number; y: number }[] = [];
  let filmed = false;

  for (const seed of SEEDS) {
    const h = await createMarchHarness();
    harnesses.push(h);
    const opened = await openQuietGame(h, seed);

    const watch = await watchVisits(h, marchFrames(WATCH_SECONDS) - opened, {
      done: (visits) => visits.length >= ARRIVALS_PER_SEED,
      onArrival: () => {
        if (filmed) return;
        filmed = true;
        // One of the sixteen arrivals the rows were read from.
        captureStill(h, "rows");
      },
    });
    for (const visit of watch.visits) {
      rows.push({ seed, id: visit.id, y: visit.y });
    }
  }

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

  const ys = rows.map((row) => row.y);
  assertGreaterThan(
    Math.max(...ys) - Math.min(...ys),
    MIN_SPAN,
    `the span of ${rows.length} entry rows, against half the ` +
      `${ROW_MAX - ROW_MIN}-unit range specs/saucer.md draws them uniformly ` +
      `from — a build entering on one fixed lane spans nothing`,
  );
});
