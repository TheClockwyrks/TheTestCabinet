// expansion/r6-waves-seed-at-zero — a clear set that is its seed alone carries no
// wave, so the step reports `lastWaves` 0.
//
// specs/rules.md gives every cell of the clear set a wave, and fixes the floor of
// the ladder outright: "Each cell of the seed is at wave `0`, and a cell an
// addition brings in from a cell at wave `k` is at wave `k + 1`, taking the
// lowest wave any addition reaches it at. `waves` is the greatest wave in the
// set, and it is `0` when the set is its seed alone." The step leaves that figure
// behind as `lastWaves`, and specs/instrumentation.md reports it.
//
// WHY THE FLOOR IS READ FIRST, AND WHY IT IS A POINT AT ALL. A wave changes
// nothing about which cells the set holds, what it scores, or what the step
// removes — it is what times the shattering, and it is the first of the two
// figures a step's own hold is built from. So the only way to read it is to read
// it, and the ladder is what tells a build that NUMBERS the waves apart from one
// that reports a constant. A build that answers with the count of cells an
// addition brought in, rather than the depth it reached, answers this point (a
// set with no additions has none of either) and fails the two above it. A build
// that reports `1` for every step fails this one and passes those.
//
// THE SCENARIO. A run of three rubies is completed across the middle of the
// board. Nothing in the run is cut, so neither the brilliant's ring nor the
// star's lines can fire; and every gem on the run-free filler is plain at strain
// `0`, so no flawed gem stands orthogonally beside the run for the third addition
// to reach. R6 therefore adds nothing at all and the clear set is exactly the R5
// seed — the case where the specification prints the figure `0` itself.
//
// WHAT IS READ, AND WHAT IS NOT. `lastWaves`, and the phase and chain step that
// say a step really resolved to report it. WHICH cells the set holds is
// `runs/r4-horizontal-run`'s point and is not read here, so a build with a
// correct wave numbering and a broken run reader loses that point rather than
// this one as well.
//
// THE EXPECTATION IS COMPUTED, NOT COPIED. `board.ts`'s `clearSetInWavesFromRuns`
// is the case's own reading of R6 over the exchanged board, and its
// `greatestWave` is what the build is held to. The figure `0` is written down
// beside it as a fixture assertion, so the two independent statements of the
// specification have to agree before the build is asked anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  allPlainAndClean,
  clearSetInWavesFromRuns,
  maximalRuns,
  quietRowsWith,
  swapped,
  type BoardRows,
  type CellRef,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";

/** The two cells the swap exchanges: the third ruby drops into row 4. */
const FROM: CellRef = { col: 3, row: 3 };
const TO: CellRef = { col: 3, row: 4 };

/**
 * The board the scenario is posed on: the run-free filler with two rubies
 * flanking a gap in row 4 and the third waiting directly above it.
 *
 * Every gem written is `R0` — plain, at strain `0` — and the filler under them is
 * plain at strain `0` throughout, which is what leaves all three of R6's
 * additions with nothing to reach.
 */
const POSED: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: FROM.col, row: FROM.row, token: "R0" },
]);

/** The board the exchange itself produces, which is what the step reads. */
const EXCHANGED: BoardRows = swapped(POSED, FROM, TO);

/** The floor of the ladder, from specs/rules.md: a seed alone is at wave `0`. */
const SEED_WAVE = 0;

/**
 * Frames recorded after the step has resolved, so the replay shows the run
 * shattering and the columns falling in behind it.
 *
 * `swapAndStep` leaves the step `0.03875` s into its own hold; twelve more frames
 * of the suite's 64 Hz clock add `0.1875` s, for `0.22625` s in all. That is
 * short of `0.3` s, the SHORTEST hold any step can have, so the board is never
 * read a second time and the assertion is made against the reading the drive
 * returned.
 */
const REPLAY_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports lastWaves 0 for a step R6 adds nothing to", async () => {
  // The fixture. The posed board carries no run, the exchange makes exactly one
  // of exactly three cells, and every gem on the exchanged board is plain at
  // strain 0 — so no brilliant, no star and no flawed gem is anywhere for an
  // addition to work on.
  assertLength(maximalRuns(POSED), 0, "runs on the posed board");
  assertLength(maximalRuns(EXCHANGED), 1, "runs the exchange makes");
  assertLength(maximalRuns(EXCHANGED)[0].cells, 3, "the length of that run");
  assertEqual(
    allPlainAndClean(EXCHANGED),
    true,
    "every gem on the exchanged board is plain at strain 0",
  );

  // The case's own reading of R6 over that board: a set that is its seed, at a
  // greatest wave of 0. Written down and computed, held to each other.
  const expected = clearSetInWavesFromRuns(EXCHANGED);
  assertLength(expected.cells, 3, "the clear set the rule computes");
  assertEqual(
    expected.greatestWave,
    SEED_WAVE,
    "the greatest wave the rule computes",
  );

  await loadBoard(h, POSED);

  const step = await captureReplay(h, "waves", async () => {
    const reading = await swapAndStep(h, FROM, TO);
    await h.advance(REPLAY_FRAMES);
    return reading;
  });

  // A step really resolved, so the figure below describes one.
  assertEqual(step.phase, "resolving", "phase after the swap animation");
  assertEqual(step.chainStep, 1, "the step the reading describes");

  // The floor of the ladder. A build that reports the number of additions, or a
  // constant of one, answers something else here.
  assertEqual(
    step.lastWaves,
    expected.greatestWave,
    "the greatest wave the step's clear set carried",
  );
});
