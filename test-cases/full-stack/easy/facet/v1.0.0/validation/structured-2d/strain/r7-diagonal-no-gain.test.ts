// Facet — strain/r7-diagonal-no-gain: R7 reaches the four cells beside a clear
// and no further.
//
// R7 of specs/rules.md raises the strain of every gem "orthogonally adjacent to
// at least one cell in the clear set". ORTHOGONALLY is the whole of this point.
// A build that reads the eight surrounding cells instead of the four — the ring
// R6 gives a `brilliant`, which is a different rule about a different set —
// spreads strain roughly twice as fast as the game is specified to, flaws gems
// the player never worked near, and hands out FLAWED_SCORE for them. Nothing
// else in the suite would notice: every gem it wrongly raised is a gem that was
// going to be raised eventually anyway.
//
// THE SCENARIO. The same horizontal ruby run of three is completed at row 4,
// and two gems are placed where a diagonal reading and an orthogonal one
// disagree: a jade at (1,3), off the corner of the run's left cell, and an
// amber at (5,5), off the corner of its right cell. Each touches the clear set
// at a corner only — walk the four orthogonal neighbors of either and none of
// them is a cleared cell — so R7 must leave both exactly as they were posed.
//
// THE TWO ARE POSED AT DIFFERENT STRAINS, 0 and 1, because the rule is that
// such a gem KEEPS the strain it had. A pair at 0 alone could not tell "left
// alone" apart from "reset to 0", and the gem at 1 also proves the reading is
// not merely reporting a resting value.
//
// Both stand in columns the clear never empties, so R9 leaves them where they
// were posed and the cell read is the cell written.
//
// WHEN THE READING IS TAKEN. specs/rules.md holds an accepted swap in
// `swapping` for SWAP_SECONDS (0.18) of game time and resolves step 1 when that
// time is spent. `swapAndStep` carries the game exactly that far and hands back
// the reading step 1 left; the step then holds the board for its own STEP_HOLD
// — `lastWaves x WAVE_SECONDS` plus `lastFall x FALL_SECONDS_PER_ROW` plus
// STEP_SECONDS — before it is read again, so no further step of the chain could
// have raised either gem for a reason of its own.
//
// THE STILL IS TAKEN WHERE THE DRIVE STOPPED. `swapAndStep` runs whole frames,
// so the canvas already holds the frame that drew the settled step, and the
// evidence is written from it rather than from a frame advanced for the picture
// alone.

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
  ring,
  swapped,
  tokenAt,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";

/** The board the scenario poses over the run-free filler. */
const CELLS: readonly PlacedToken[] = [
  // The two ends of the run, and the ruby that completes it from above.
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: 3, row: 3, token: "R0" },
  // The two gems that touch the clear set at a corner and nowhere else.
  { col: 1, row: 3, token: "J0" },
  { col: 5, row: 5, token: "A1" },
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
 * Each diagonal gem: where it stands, and the token it must still read after
 * the step — which is the token it was posed with, unchanged.
 */
const DIAGONAL: readonly { what: string; cell: CellRef; token: string }[] = [
  {
    what: "the jade off the corner of the run's left cell",
    cell: { col: 1, row: 3 },
    token: "J0",
  },
  {
    what: "the amber off the corner of the run's right cell",
    cell: { col: 5, row: 5 },
    token: "A1",
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a gem that touches the clear set only at a corner", async () => {
  const posed = quietRowsWithEscape(CELLS);
  const resolved = swapped(posed, SWAP.a, SWAP.b);
  const inClearSet = (cell: CellRef): boolean =>
    CLEARED.some(
      (cleared) => cleared.col === cell.col && cleared.row === cell.row,
    );

  // The fixture states its own premises: the posed board rests, the swap clears
  // exactly the ruby run, and each marked gem touches that clear set at a
  // corner (its eight surrounding cells hold one) and not on a side (its four
  // orthogonal neighbors hold none). Those two facts together are the case
  // this point is about, and without both the reading below would say nothing.
  assertLength(maximalRuns(posed), 0, "runs on the posed board");
  assertDeepEqual(clearSetFromRuns(resolved), CLEARED, "the step's clear set");
  for (const mark of DIAGONAL) {
    assertTrue(
      ring(mark.cell.col, mark.cell.row).some(inClearSet),
      `${mark.what} touches the clear set diagonally`,
    );
    assertTrue(
      !neighbors(mark.cell.col, mark.cell.row).some(inClearSet),
      `${mark.what} touches no cell of the clear set orthogonally`,
    );
  }

  loadBoard(h, posed);

  // Through the swap animation to the result of step 1, taken inside that
  // step's own hold, so what it reports is R7's own answer.
  const stepOne = await swapAndStep(h, SWAP.a, SWAP.b);
  const rows = renderBoard(stepOne);
  captureStill(h, "strain");

  assertEqual(stepOne.chainStep, 1, "the chain step the accepted swap opened");

  for (const mark of DIAGONAL) {
    assertEqual(
      tokenAt(rows, mark.cell.col, mark.cell.row),
      mark.token,
      `${mark.what}, at (${mark.cell.col},${mark.cell.row}) after the step`,
    );
  }
});
