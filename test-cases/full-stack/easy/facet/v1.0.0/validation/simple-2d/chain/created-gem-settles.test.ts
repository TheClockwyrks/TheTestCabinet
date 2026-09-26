// chain/created-gem-settles — a created gem settles with the board.
//
// A cut gem is not placed after the dust has cleared: specs/rules.md orders the
// step "6. R8 creates the cut gems, then 7. R9 settles each column and refills
// it", and R8 puts the created gem at a cell "which the removal left empty". So
// the gem exists before the column falls, and R9 makes no exception for it —
// "every surviving gem falls to the lowest empty cell below it". A build that
// creates the gem after settling, or that pins it to the cell it was placed at,
// leaves it hanging where the run stood, with empty cells beneath it.
//
// THE SCENARIO SEPARATES THE PLACEMENT FROM THE REST. A vertical run of four
// rubies fills column 4 at rows 2 to 5. R8's placement rule puts the created gem
// "at whichever of the two cells the chain's swap exchanged lies in the run" —
// the swap trades a ruby in from (5,3), so the run's cell at (4,3) is where the
// brilliant is placed, with two of the run's own emptied cells, (4,4) and (4,5),
// directly beneath it and nothing else in the column empty below them. R9 has
// exactly one answer: the brilliant comes to rest at (4,5).
//
// The cut is what identifies it. R9's refill deals `plain` gems alone and the
// posed board carries no brilliant, so the one brilliant on the settled board is
// the one R8 created, and where it stands is the whole of this point.
//
// WHEN THE READING IS TAKEN. An accepted swap exchanges the two cells at once
// and sets `phase` to `swapping` with `chainStep` at `0`; step 1 resolves once
// `swapTimer` reaches `SWAP_SECONDS` (`0.18`) of game time, and R8 and R9 both
// run inside that one step. `swapAndStep` carries the game through exactly that
// animation and hands back the reading of step 1's result, which is the board
// this check reads. The frames driven afterwards are for the replay alone and
// are counted so that the board is never read a second time.
//
// The engine holds the state BY VALUE, so a pose returns the next state and the
// harness's driver applies it; a reading is synchronous. Only the frame drive is
// awaited. The scenario itself is the specification's, and reads the same under
// all three engines.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertTrue,
} from "../assert";
import {
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
  captureReplay,
  createHarness,
  framesShortOf,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";
import type { FacetSnapshot } from "../surface";

/**
 * A vertical run of four in column 4, three quarters posed and the last quarter
 * traded in from (5,3) — so the swap's own cell lies in the run at index 1,
 * counting from the run's lowest-row end as R8 does.
 */
const CELLS: PlacedToken[] = [
  { col: 4, row: 2, token: "R0" },
  { col: 4, row: 3, token: "A0" },
  { col: 4, row: 4, token: "R0" },
  { col: 4, row: 5, token: "R0" },
  { col: 5, row: 3, token: "R0" },
];

const SWAP_A: CellRef = { col: 4, row: 3 };
const SWAP_B: CellRef = { col: 5, row: 3 };

/** Where R8 places the brilliant: the run's cell the swap exchanged. */
const PLACED_AT: CellRef = { col: 4, row: 3 };

/** The lowest cell the removal left empty below the placement, where R9 rests it. */
const RESTS_AT: CellRef = { col: 4, row: 5 };

/**
 * Frames that carry the recording to just short of the end of the step the
 * reading was taken in.
 *
 * A step's hold is the step's OWN figure — `lastWaves * WAVE_SECONDS` plus
 * `lastFall * FALL_SECONDS_PER_ROW` plus `STEP_SECONDS`, which the snapshot
 * reports as `stepHold` — so the frames that fill it are read off the snapshot
 * rather than written down. `framesShortOf` keeps the drive strictly inside what
 * is left of the hold, so the board is never read a second time and the reading
 * asserted below still describes step 1.
 */
function restOfStep(reading: FacetSnapshot): number {
  return framesShortOf(Math.max(0, reading.stepHold - reading.stepTimer));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("settles the created brilliant to the lowest cell the removal emptied", async () => {
  const posed = quietRowsWithEscape(CELLS);
  // The fixture's own guarantees: no run stands on the posed board, the swap is
  // one R1 and R3 both accept, and what it makes is a single run of exactly four
  // — which is the run length R8 answers with a brilliant.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertTrue(swapIsLegal(posed, SWAP_A, SWAP_B), "R1 and R3 accept the swap");
  const made = maximalRuns(swapped(posed, SWAP_A, SWAP_B));
  assertLength(made, 1, "maximal runs the swap makes");
  assertLength(made[0].cells, 4, "cells in the run the swap makes");
  // And no brilliant is on the board to be mistaken for the created one.
  assertLength(
    posed.flatMap((row) =>
      row.split(" ").filter((token) => parseToken(token).cut === "brilliant"),
    ),
    0,
    "brilliants on the posed board",
  );

  loadBoard(h, posed);
  const first = await captureReplay(h, "settle", async () => {
    const resolved = await swapAndStep(h, SWAP_A, SWAP_B);
    await h.advance(restOfStep(resolved));
    return resolved;
  });

  assertEqual(first.chainStep, 1, "the chain step the swap resolved into");

  // One brilliant on the board, and it is at the lowest cell the removal left
  // empty rather than at the cell R8 placed it in: (4,3) held it when the column
  // fell, (4,4) and (4,5) were empty beneath it, and R9 carried it to the bottom
  // of that gap. A build that never settled it would report it at (4,3).
  const brilliants = first.board.cells
    .filter((cell) => cell.cut === "brilliant")
    .map((cell) => ({ col: cell.col, row: cell.row }));
  assertLength(brilliants, 1, "brilliants on the settled board");
  assertDeepEqual(brilliants[0], RESTS_AT, "where the created brilliant rests");
  assertEqual(
    parseToken(renderCell(first, PLACED_AT.col, PLACED_AT.row)).cut,
    "plain",
    "the cut left standing at the cell R8 placed the brilliant in",
  );
});
