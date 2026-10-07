// Facet — strain/r7-reaches-flawed: strain accumulated over the clears a gem
// has stood beside carries it all the way to flawed.
//
// specs/board.md: strain is a whole number from 0 to MAX_STRAIN (3), and "a gem
// at MAX_STRAIN is flawed". R7 is the only thing that moves it, and this is the
// last step of that climb — the one that turns an ordinary gem into the flawed
// one the rest of the ruleset treats differently. A build that stops short of
// it, or that caps at 2, or that treats strain as a decoration a gem never
// actually reaches the top of, produces a board on which no gem is ever flawed
// and the game's whole pressure mechanic is missing.
//
// THE SCENARIO. An amber is posed at (1,4) already carrying strain 2 — a gem
// that has stood beside two earlier clears — and a horizontal ruby run of three
// is then completed beside it at row 4, columns 2 to 4, by dropping the ruby
// posed at (3,3) into (3,4). The amber borders the run's left cell, so R7
// raises it, and the strain it had puts that raise at exactly the top of the
// scale.
//
// WHY THE AMBER IS POSED AT 2 AND NOT AT 3. R6 grows the clear set by "every
// flawed gem orthogonally adjacent to a cell in the set", and R6 runs before R7
// does. A gem posed at MAX_STRAIN beside this run would be taken INTO the clear
// set and removed, so the only gem R7 can be observed carrying to flawed is one
// that arrives at MAX_STRAIN during the step itself. That is what is posed
// here.
//
// Column 1 loses no cell, so R9 leaves the amber where it was posed.
//
// WHEN THE READING IS TAKEN. specs/rules.md holds an accepted swap in
// `swapping` for SWAP_SECONDS (0.18) of game time, clearing nothing, and
// resolves step 1 when that time is spent. `swapAndStep` carries the game
// exactly that far and hands back the reading step 1 left; the step then holds
// the board for its own STEP_HOLD — `lastWaves x WAVE_SECONDS` plus `lastFall x
// FALL_SECONDS_PER_ROW` plus STEP_SECONDS — before it is read again, so the
// strain read is the one step's, not a chain's.
//
// What a flawed gem then DOES is other points': that it is drawn into the next
// clear set is `expansion/r6-flawed-adjacent-taken`, that it scores FLAWED_SCORE
// is
// `scoring/score-flawed-rate`. None of it is asserted here.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import { MAX_STRAIN } from "../constants";
import {
  clearSetFromRuns,
  isFlawed,
  maximalRuns,
  neighbors,
  quietRowsWithEscape,
  renderBoard,
  strainAt,
  swapped,
  tokenAt,
  tokenOf,
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

/** The strain the marked amber is posed carrying: one short of flawed. */
const POSED_STRAIN = MAX_STRAIN - 1;

/**
 * The amber the step carries to MAX_STRAIN. It does not move: column 1 loses no
 * cell to the clear.
 */
const MARKED: CellRef = { col: 1, row: 4 };

/** The board the scenario poses over the run-free filler. */
const CELLS: readonly PlacedToken[] = [
  // The two ends of the run, and the ruby that completes it from above.
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  // The worn amber beside the run's left end.
  {
    col: MARKED.col,
    row: MARKED.row,
    token: tokenOf("amber", POSED_STRAIN),
  },
];

/** The exchange that completes the run: the ruby at (3,3) falls into (3,4). */
const SWAP: { a: CellRef; b: CellRef } = {
  a: { col: 3, row: 3 },
  b: { col: 3, row: 4 },
};

/** The cells the step clears. R6 adds nothing: the amber is not yet flawed. */
const CLEARED: readonly CellRef[] = [
  { col: 2, row: 4 },
  { col: 3, row: 4 },
  { col: 4, row: 4 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries a gem one short of flawed the rest of the way", async () => {
  const posed = quietRowsWithEscape(CELLS);
  const resolved = swapped(posed, SWAP.a, SWAP.b);

  // The fixture states its own premises: the posed board rests, the amber is
  // one short of flawed, it borders the clear set, and — because it is not yet
  // flawed — R6 leaves the clear set at the run's three cells rather than
  // drawing the amber into it. All four are what make the reading below R7's
  // answer.
  assertLength(maximalRuns(posed), 0, "runs on the posed board");
  assertTrue(!isFlawed(POSED_STRAIN), "the posed amber is not already flawed");
  assertTrue(
    neighbors(MARKED.col, MARKED.row).some((beside) =>
      CLEARED.some(
        (cell) => cell.col === beside.col && cell.row === beside.row,
      ),
    ),
    "the amber touches the clear set orthogonally",
  );
  assertDeepEqual(clearSetFromRuns(resolved), CLEARED, "the step's clear set");

  loadBoard(h, posed);

  const taken = await captureReplay(h, "flaw", async () => {
    // Through the swap animation to the result of step 1, read inside that
    // step's own hold. The chain is driven on afterwards only so the replay
    // carries the whole move.
    const stepOne = await swapAndStep(h, SWAP.a, SWAP.b);
    const read = { rows: renderBoard(stepOne), chainStep: stepOne.chainStep };
    await resolveChain(h);
    return read;
  });

  assertEqual(taken.chainStep, 1, "the chain step the accepted swap opened");

  const strain = strainAt(taken.rows, MARKED.col, MARKED.row);
  assertEqual(
    tokenAt(taken.rows, MARKED.col, MARKED.row),
    tokenOf("amber", MAX_STRAIN),
    `the amber at (${MARKED.col},${MARKED.row}) after the step beside it`,
  );
  assertEqual(
    strain,
    MAX_STRAIN,
    "the strain it came out of the step carrying",
  );
  assertTrue(isFlawed(strain), "the gem specs/board.md calls flawed");
});
