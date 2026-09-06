// chain/chain-second-step — a chain runs on into a second step.
//
// specs/rules.md ends a step with a re-read, not with the clear: "When that board
// seeds a non-empty clear set under R5, `chainStep` rises by `1` and that step
// resolves in the same order." So a build that clears once and stops has not
// implemented a chain, and one that raises `chainStep` without clearing the
// second board has raised a counter and nothing else. Both are what this reads.
//
// THE SECOND RUN IS MADE BY THE SETTLING, NOT POSED. A swap completes three
// rubies across row 4. Column 4 already carries a jade at rows 3, 5 and 6, which
// is no run at all while the ruby at (4,4) stands between them; step 1 removes
// that ruby, R9 drops the jade at (4,3) into (4,4), and the three jades are a
// maximal run on the board step 2 reads. Nothing about the second run is posed —
// it exists only because the first step settled.
//
// HOW THE TWO STEPS ARE REACHED. An accepted swap exchanges the two cells at
// once, sets `phase` to `swapping`, sets `swapTimer` to `0` and leaves
// `chainStep` at `0`; step 1 resolves when `swapTimer` reaches `SWAP_SECONDS`
// (`0.18`) of game time. `swapAndStep` carries the game through exactly that
// animation and hands back the reading of step 1's result. The board then holds
// for that step's OWN length — `lastWaves * WAVE_SECONDS` plus
// `lastFall * FALL_SECONDS_PER_ROW` plus `STEP_SECONDS`, which the snapshot
// reports as `stepHold` — and `advanceStep` carries past exactly that one
// boundary, reading the figure off the snapshot rather than counting a constant.
// So neither drive here writes a frame count down, and a step whose gems fell
// further is waited out for exactly as long as it asks for.
//
// WHAT IS ASSERTED IS COMPUTED FROM THE BOARD THAT WAS OBSERVED. R9 refills the
// top of every cleared column from the game's own random draw, and what it
// deals there is the build's business: it could itself seed a run. So the
// expectation is read off the settled board the build reported, through R5's
// seed and R6's closure, rather than predicted from the posed board — a refill
// that dealt a run belongs in the count exactly as much as the planted jades do.
//
// Everything crosses into the page, so every reading is awaited. The
// scenario itself is the specification's, and reads the same under all three
// engines.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotEqual,
  assertTrue,
} from "../assert";
import {
  clearSetFromRuns,
  maximalRuns,
  parseToken,
  quietRowsWithEscape,
  renderCell,
  swapIsLegal,
  swapped,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  advanceStep,
  captureReplay,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";

/** Step 1's run across row 4, and the amethyst the swap trades out of it. */
const STEP_ONE: PlacedToken[] = [
  { col: 3, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 5, row: 4, token: "M0" },
  { col: 6, row: 4, token: "R0" },
];

/**
 * The jades step 2 clears — no run while the ruby at (4,4) parts them, and a
 * column of three the moment step 1 has removed it and R9 has closed the gap.
 */
const STEP_TWO: PlacedToken[] = [
  { col: 4, row: 3, token: "J0" },
  { col: 4, row: 5, token: "J0" },
  { col: 4, row: 6, token: "J0" },
];

/** The swap that carries the ruby at (6,4) into the row. */
const SWAP_A: CellRef = { col: 5, row: 4 };
const SWAP_B: CellRef = { col: 6, row: 4 };

/** Where the fallen jades stand on the board step 2 reads. */
const FALLEN_RUN: CellRef[] = [
  { col: 4, row: 4 },
  { col: 4, row: 5 },
  { col: 4, row: 6 },
];

/** Whether a computed clear set holds one cell. */
function holds(cells: readonly CellRef[], wanted: CellRef): boolean {
  return cells.some((c) => c.col === wanted.col && c.row === wanted.row);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the settled board again and clears the run the settling made", async () => {
  const posed = quietRowsWithEscape([...STEP_ONE, ...STEP_TWO]);
  // The fixture's own guarantees, asserted here so that anything that fails
  // below is the build's: the posed board carries no run of its own, the swap is
  // one R1 and R3 both accept, and the only run it makes is step 1's.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  assertLength(
    maximalRuns(swapped(posed, SWAP_A, SWAP_B)),
    1,
    "maximal runs the swap makes",
  );

  await loadBoard(h, posed);
  const first = await swapAndStep(h, SWAP_A, SWAP_B);
  assertEqual(first.chainStep, 1, "the chain step the swap resolved into");
  assertEqual(first.phase, "resolving", "the phase step 1 resolved in");

  // Read the board step 1 left, and take R5's seed and R6's closure over exactly
  // that board. The three fallen jades must be in it — that is the scenario, and
  // a build whose settling never made the run would fail here rather than at the
  // count below, which says which of the two went wrong.
  const settled = await h.board();
  const expected = clearSetFromRuns(settled);
  for (const cell of FALLEN_RUN) {
    assertTrue(
      holds(expected, cell),
      `the settled board seeds (${cell.col},${cell.row})`,
    );
  }

  const second = await captureReplay(h, "chain", () => advanceStep(h));

  // The step boundary raised the chain rather than ending it, and the step it
  // opened cleared that board's whole clear set.
  assertEqual(second.chainStep, 2, "chainStep after the step boundary");
  assertEqual(second.phase, "resolving", "phase after the step boundary");
  assertEqual(
    second.lastCleared,
    expected.length,
    "cells the second step cleared",
  );

  // And the set really left the board. What R9 drops into the three cells is
  // column 4's beryl, amethyst and amber — the gems that stood above the jades —
  // so no compliant settling leaves a jade standing in any of them, and the
  // refill cannot reach that far down the column to put one back.
  for (const cell of FALLEN_RUN) {
    assertNotEqual(
      parseToken(renderCell(second, cell.col, cell.row)).kind,
      "jade",
      `the kind at (${cell.col},${cell.row}) after the second step`,
    );
  }
});
