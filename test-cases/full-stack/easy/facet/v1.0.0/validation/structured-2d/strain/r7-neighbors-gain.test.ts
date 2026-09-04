// Facet — strain/r7-neighbors-gain: a chain step leaves its mark on the gems
// standing around what it took.
//
// R7 of specs/rules.md: "Every gem outside the clear set that is orthogonally
// adjacent to at least one cell in the clear set gains 1 strain, capped at
// MAX_STRAIN." That single sentence is what this point decides. It is the only
// thing on the board that makes strain rise at all, so a build that clears runs
// and leaves everything around them untouched never produces a flawed gem — and
// with it goes FLAWED_SCORE, R6's flawed addition, and the pressure the game is
// named for.
//
// THE SCENARIO. A horizontal ruby run of three is completed at row 4 by
// dropping the ruby posed at (3,3) into (3,4). Four gems of four other kinds
// stand around it, each plain, each at strain 0, and each touching the run on
// exactly one side: an amber off the left end, a citrine off the right end, a
// jade directly above the run's left cell, and a sapphire directly below its
// center. Four DISTINCT kinds, so the expected reading names which gem is being
// read as well as what strain it carries: a check that lost track of a cell
// reads the wrong letter rather than quietly passing.
//
// WHERE EACH GEM IS READ. R7 raises strain while the clear set is still on the
// board, and R9 settles the columns afterwards, so a marked gem is read where
// the step LEFT it rather than where it was posed. Three of the four stand
// still — two are in columns the clear never emptied, and the sapphire sits
// below the cell its column lost — while the jade above the run falls exactly
// one row into the cell the run vacated.
//
// WHEN THE READING IS TAKEN. specs/rules.md holds an accepted swap in
// `swapping` for SWAP_SECONDS (0.18) of game time, with `chainStep` at 0 and
// nothing cleared, and resolves step 1 when that time is spent. `swapAndStep`
// carries the game exactly that far and hands back the reading step 1 left
// behind. The step then holds the board for its own STEP_HOLD — `lastWaves x
// WAVE_SECONDS` plus `lastFall x FALL_SECONDS_PER_ROW` plus STEP_SECONDS —
// before the board is read again, so what this reads is R7's own answer and no
// later step of the chain can have touched it.
//
// WHAT ELSE THE BOARD DOES NOT DO. Every gem posed is plain and unflawed, so R6
// adds nothing to R5's seed and the clear set is the run and nothing more; the
// filler under it carries no run of its own, so nothing but the placed cells
// matches. The spare legal swap in the far corner is what keeps the round alive
// while the chain plays out for the replay.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
  clearSetFromRuns,
  maximalRuns,
  neighbors,
  quietRowsWithEscape,
  renderBoard,
  swapped,
  tokenAt,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  resolveChain,
  swapAndStep,
  type Harness,
} from "../harness";

/** The board the scenario poses over the run-free filler. */
const CELLS: readonly PlacedToken[] = [
  // The two ends of the run, and the ruby that completes it from above.
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  // The four marked gems, one on each side of the run.
  { col: 1, row: 4, token: "A0" },
  { col: 5, row: 4, token: "C0" },
  { col: 2, row: 3, token: "J0" },
  { col: 3, row: 5, token: "S0" },
];

/** The exchange that completes the run: the ruby at (3,3) falls into (3,4). */
const SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 3, row: 4 },
};

/** The cells the step clears: R5's seed, which R6 grows by nothing here. */
const CLEARED: readonly CellRef[] = [
  { col: 2, row: 4 },
  { col: 3, row: 4 },
  { col: 4, row: 4 },
];

/**
 * Each marked gem: what it is, the cell it was posed at, the cell R9 leaves it
 * in, and the token it must read once the step has resolved.
 *
 * The digit is R7's answer and the letter says the gem is the one that was
 * marked, so a build that raised the wrong cell's strain fails with a pair a
 * reader can place on the board.
 */
const MARKED: readonly {
  what: string;
  posed: CellRef;
  read: CellRef;
  token: string;
}[] = [
  {
    what: "the amber off the run's left end",
    posed: { col: 1, row: 4 },
    read: { col: 1, row: 4 },
    token: "A1",
  },
  {
    what: "the citrine off the run's right end",
    posed: { col: 5, row: 4 },
    read: { col: 5, row: 4 },
    token: "C1",
  },
  {
    what: "the jade above the run, fallen one row into the cell it vacated",
    posed: { col: 2, row: 3 },
    read: { col: 2, row: 4 },
    token: "J1",
  },
  {
    what: "the sapphire below the run's center",
    posed: { col: 3, row: 5 },
    read: { col: 3, row: 5 },
    token: "S1",
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("raises by one the strain of every gem touching the clear set", async () => {
  const posed = quietRowsWithEscape(CELLS);
  const resolved = swapped(posed, SWAP.a, SWAP.b);

  // The fixture states its own premises rather than assuming them: the posed
  // board rests, the swap clears exactly the ruby run, and each marked gem
  // really is orthogonally adjacent to that clear set — which is R7's
  // antecedent and therefore the thing the reading below is a consequence of.
  assertLength(maximalRuns(posed), 0, "runs on the posed board");
  assertDeepEqual(clearSetFromRuns(resolved), CLEARED, "the step's clear set");
  for (const mark of MARKED) {
    assertTrue(
      neighbors(mark.posed.col, mark.posed.row).some((beside) =>
        CLEARED.some(
          (cell) => cell.col === beside.col && cell.row === beside.row,
        ),
      ),
      `${mark.what} touches the clear set orthogonally`,
    );
  }

  loadBoard(h, posed);

  const taken = await captureReplay(h, "strain", async () => {
    // Through the swap animation to the result of step 1. The reading is taken
    // there, inside the step's own hold, so the strain it reports was raised by
    // that one step; the chain is then driven on purely so the replay carries
    // the whole move.
    const stepOne = await swapAndStep(h, SWAP.a, SWAP.b);
    const read = { rows: renderBoard(stepOne), chainStep: stepOne.chainStep };
    await resolveChain(h);
    return read;
  });

  // The swap was accepted and it is step 1 that is being read, so a fixture
  // whose swap was refused fails as a refusal rather than as a missing strain.
  assertEqual(taken.chainStep, 1, "the chain step the accepted swap opened");

  for (const mark of MARKED) {
    assertEqual(
      tokenAt(taken.rows, mark.read.col, mark.read.row),
      mark.token,
      `${mark.what}, at (${mark.read.col},${mark.read.row}) after the step`,
    );
  }
});
