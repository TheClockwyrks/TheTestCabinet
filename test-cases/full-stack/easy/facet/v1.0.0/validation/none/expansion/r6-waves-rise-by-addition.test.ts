// expansion/r6-waves-rise-by-addition — a cell an addition brings in is one wave
// out, so a step whose seed holds a brilliant reports `lastWaves` 1.
//
// specs/rules.md numbers the clear set: "Each cell of the seed is at wave `0`,
// and a cell an addition brings in from a cell at wave `k` is at wave `k + 1`,
// taking the lowest wave any addition reaches it at. `waves` is the greatest wave
// in the set". A seed with one addition applied to it reaches exactly one wave
// out, and the step leaves that figure behind as `lastWaves`.
//
// WHY IT IS THE MIDDLE RUNG OF A LADDER OF THREE. A wave changes nothing about
// membership, scoring or removal, so the only way to read the numbering is to
// read the figure — and one reading of it decides nothing, because several wrong
// rules answer any single case. `expansion/r6-waves-seed-at-zero` reads the floor,
// this reads one step up, and `expansion/r6-waves-chain-through-flawed` reads the
// case an addition is reached THROUGH another addition. A build that gives every
// added cell wave `1` answers this point and fails the third; a build that
// reports the count of cells the additions brought in answers the first and fails
// this one, since the ring here brings in six.
//
// THE SCENARIO IS `expansion/r6-brilliant-ring`'s, and deliberately so. A run of
// three rubies is completed across the middle of the board with a ruby BRILLIANT
// as its middle cell, far enough from every edge that all eight of the cells
// surrounding it lie on the board. Each of those eight is an ordinary plain gem
// at strain `0`, so no second addition fires off any of them: the brilliant's ring
// enters at wave `1` and nothing enters behind it. WHICH nine cells the set holds
// is that point's claim; the depth the numbering reached is this one's.
//
// WHAT IS READ, AND WHAT IS NOT. `lastWaves`, and the phase and chain step that
// say a step really resolved to report it. The membership and the count are left
// to `expansion/r6-brilliant-ring`, so a build with a correct numbering and a
// clipped ring loses that point rather than this one as well.
//
// THE EXPECTATION IS COMPUTED, NOT COPIED. `board.ts`'s `clearSetInWavesFromRuns`
// is the case's own reading of R6 over the exchanged board, and its
// `greatestWave` is what the build is held to. The figure `1` is written down
// beside it as a fixture assertion, so the two independent statements of the
// specification have to agree before the build is asked anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  clearSetInWavesFromRuns,
  maximalRuns,
  quietRowsWith,
  ring,
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

/** The brilliant, at the middle of the run and clear of every edge. */
const BRILLIANT: CellRef = { col: 3, row: 4 };

/** The two cells the swap exchanges: the third ruby drops into the run. */
const FROM: CellRef = { col: 2, row: 3 };
const TO: CellRef = { col: 2, row: 4 };

/**
 * The board the scenario is posed on: the run-free filler carrying the
 * brilliant, the ruby beside it, and the ruby the swap brings down into the run.
 */
const POSED: BoardRows = quietRowsWith([
  { col: FROM.col, row: FROM.row, token: "R0" },
  { col: BRILLIANT.col, row: BRILLIANT.row, token: "R0b" },
  { col: 4, row: 4, token: "R0" },
]);

/** The board the exchange itself produces, which is what the step reads. */
const EXCHANGED: BoardRows = swapped(POSED, FROM, TO);

/** One addition out from the seed, from specs/rules.md's `k + 1`. */
const ONE_ADDITION = 1;

/** The run's three cells and the eight around the brilliant, counted once each. */
const CLEAR_SET_SIZE = 9;

/**
 * Frames recorded after the step has resolved, so the replay shows the run
 * shattering and the ring going a wave behind it.
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

it("reports lastWaves 1 when one addition grows the seed", async () => {
  // The fixture. The posed board carries no run, the exchange makes exactly one
  // of exactly three cells, and the brilliant really has all eight of its
  // surrounding cells on the board — five or three would still reach wave 1, but
  // the scenario this point borrows is the whole ring.
  assertLength(maximalRuns(POSED), 0, "runs on the posed board");
  assertLength(maximalRuns(EXCHANGED), 1, "runs the exchange makes");
  assertLength(maximalRuns(EXCHANGED)[0].cells, 3, "the length of that run");
  assertLength(
    ring(BRILLIANT.col, BRILLIANT.row),
    8,
    "surrounding cells on the board around the brilliant",
  );

  // The case's own reading of R6 over that board: nine cells, reaching one wave
  // out. Written down and computed, held to each other.
  const expected = clearSetInWavesFromRuns(EXCHANGED);
  assertLength(
    expected.cells,
    CLEAR_SET_SIZE,
    "the clear set the rule computes",
  );
  assertEqual(
    expected.greatestWave,
    ONE_ADDITION,
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

  // One wave out, not none and not two. A build that left every cell of the set
  // at the seed's own wave reports `0`; one that counted the six new cells the
  // ring brought in reports `6`.
  assertEqual(
    step.lastWaves,
    expected.greatestWave,
    "the greatest wave the step's clear set carried",
  );
});
