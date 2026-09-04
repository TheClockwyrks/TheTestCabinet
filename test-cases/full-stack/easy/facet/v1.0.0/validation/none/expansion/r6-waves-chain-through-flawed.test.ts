// expansion/r6-waves-chain-through-flawed — an addition reached THROUGH another
// addition is two waves out, so the step reports `lastWaves` 2.
//
// specs/rules.md numbers the clear set by the path that reached each cell: "a
// cell an addition brings in from a cell at wave `k` is at wave `k + 1`, taking
// the lowest wave any addition reaches it at". A cell no addition can reach from
// the seed, and that only a cell an addition already brought in can reach, is
// therefore at wave `2` — and since `waves` is the greatest wave in the set, the
// step reports `2`.
//
// WHY THIS IS THE RUNG THAT DECIDES THE LADDER. R6's closure is a least fixed
// point, so a build that computes the MEMBERSHIP correctly may still hand every
// added cell the same number. That build answers
// `expansion/r6-waves-rise-by-addition` — where nothing is reached through
// anything — and fails here, which is exactly what makes the two separate
// points. A build that numbers by the traversal that produced the set answers
// both.
//
// THE SCENARIO. A run of three rubies is completed across row 4, and a line of
// two flawed gems runs away from its right-hand end:
//
//   - the run's cells `(2,4)`, `(3,4)` and `(4,4)` are the seed, at wave `0`;
//   - the flawed gem at `(5,4)` is orthogonally adjacent to the run's `(4,4)`, so
//     the third addition takes it at wave `1`;
//   - the flawed gem at `(6,4)` touches no cell of the seed at all. Its four
//     orthogonal neighbors are `(6,3)`, `(6,5)`, `(7,4)` and `(5,4)`, and only the
//     last of those is ever in the set — so the only path to it runs THROUGH the
//     gem at wave `1`, and it enters at wave `2`.
//
// Neither flawed gem is cut, and nothing else on the board is flawed or cut, so
// the set closes at five cells and the ladder stops at `2`. Both flawed gems keep
// the run-free filler's own kind at their cell and differ from it in strain
// alone, so neither can make or lengthen a run: the amethyst the filler holds at
// `(5,4)` is what bounds the run's right-hand end whether it is flawed or not.
//
// WHAT IS READ, AND WHAT IS NOT. `lastWaves`, and the phase and chain step that
// say a step really resolved to report it. That the flawed gems are TAKEN at all
// is `expansion/r6-flawed-adjacent-taken`'s point and that a chain of them is
// taken end
// to end is `expansion/r6-closure-along-a-flawed-line`'s, so neither the
// membership nor the count is
// read here.
//
// THE EXPECTATION IS COMPUTED, NOT COPIED. `board.ts`'s `clearSetInWavesFromRuns`
// is the case's own reading of R6 over the exchanged board, and its
// `greatestWave` is what the build is held to. The figure `2` is written down
// beside it as a fixture assertion, so the two independent statements of the
// specification have to agree before the build is asked anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import {
  areAdjacent,
  clearSetInWavesFromRuns,
  maximalRuns,
  quietRowsWith,
  strainAt,
  swapped,
  type BoardRows,
  type CellRef,
} from "../board";
import { MAX_STRAIN } from "../constants";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";

/** The run of three the swap completes, across row 4. */
const RUN: readonly CellRef[] = [
  { col: 2, row: 4 },
  { col: 3, row: 4 },
  { col: 4, row: 4 },
];

/** The flawed gem orthogonally beside the run's right-hand end: wave 1. */
const NEARER: CellRef = { col: 5, row: 4 };

/** The flawed gem orthogonally beside only the nearer one: wave 2. */
const FARTHER: CellRef = { col: 6, row: 4 };

/** The two cells the swap exchanges: the third ruby rises into the run. */
const FROM: CellRef = { col: 3, row: 5 };
const TO: CellRef = { col: 3, row: 4 };

/**
 * The board the scenario is posed on.
 *
 * The two flawed gems are written at the strain the run-free filler's own kind
 * already sits at that cell with, so the line changes nothing about which lines
 * of the board hold a run. `M3` is the filler's amethyst at `(5,4)` and `R3` its
 * ruby at `(6,4)`, each raised to `MAX_STRAIN`.
 */
const POSED: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: FROM.col, row: FROM.row, token: "R0" },
  { col: NEARER.col, row: NEARER.row, token: "M3" },
  { col: FARTHER.col, row: FARTHER.row, token: "R3" },
]);

/** The board the exchange itself produces, which is what the step reads. */
const EXCHANGED: BoardRows = swapped(POSED, FROM, TO);

/** Two additions out from the seed, from specs/rules.md's `k + 1` twice over. */
const TWO_ADDITIONS = 2;

/** The run's three cells and the two flawed gems the line adds behind them. */
const CLEAR_SET_SIZE = 5;

/**
 * Frames recorded after the step has resolved, so the replay shows the run
 * shattering and the flawed line going outward behind it, a wave at a time.
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

it("reports lastWaves 2 when one addition is reached through another", async () => {
  // The fixture, and here it carries the whole distinction the point rests on.
  // The posed board holds no run; the exchange makes exactly one, three cells
  // long. Both placed gems are at MAX_STRAIN. The nearer one is orthogonally
  // adjacent to a cell of the seed, and the farther one is adjacent to NO cell of
  // the seed — which is what makes the second reachable only through the first.
  assertLength(maximalRuns(POSED), 0, "runs on the posed board");
  assertLength(maximalRuns(EXCHANGED), 1, "runs the exchange makes");
  assertLength(maximalRuns(EXCHANGED)[0].cells, 3, "the length of that run");
  assertEqual(
    strainAt(EXCHANGED, NEARER.col, NEARER.row),
    MAX_STRAIN,
    "the strain of the gem beside the run",
  );
  assertEqual(
    strainAt(EXCHANGED, FARTHER.col, FARTHER.row),
    MAX_STRAIN,
    "the strain of the gem beyond it",
  );
  assertTrue(
    RUN.some((cell) => areAdjacent(cell, NEARER)),
    "the nearer flawed gem touches the seed orthogonally",
  );
  assertTrue(
    !RUN.some((cell) => areAdjacent(cell, FARTHER)),
    "the farther flawed gem touches no cell of the seed orthogonally",
  );
  assertTrue(
    areAdjacent(NEARER, FARTHER),
    "the farther flawed gem touches the nearer one orthogonally",
  );

  // The case's own reading of R6 over that board: five cells, reaching two waves
  // out. Written down and computed, held to each other.
  const expected = clearSetInWavesFromRuns(EXCHANGED);
  assertLength(
    expected.cells,
    CLEAR_SET_SIZE,
    "the clear set the rule computes",
  );
  assertEqual(
    expected.greatestWave,
    TWO_ADDITIONS,
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

  // Two waves out. A build that gave every added cell wave `1` reports `1` here
  // and passes `expansion/r6-waves-rise-by-addition`, which is what makes the two
  // separate points.
  assertEqual(
    step.lastWaves,
    expected.greatestWave,
    "the greatest wave the step's clear set carried",
  );
});
