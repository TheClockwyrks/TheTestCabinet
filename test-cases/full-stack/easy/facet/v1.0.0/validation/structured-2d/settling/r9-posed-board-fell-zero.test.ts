// settling/r9-posed-board-fell-zero — a board written into the game is a board
// standing still, and every cell of it says so.
//
// WHAT THE RULE IS. specs/instrumentation.md says it of both operations that
// write a board. Of `loadBoard`: "Every gem of a posed board is standing still
// where it was written, so every cell reports a `fell` of `0`." Of `setGem`: the
// gem at that cell "takes the kind, the strain, and the cut the token names, and
// a `fell` of `0`". specs/board.md's notation has no `fell` to write — a written
// board records where every gem stands and nothing about how it got there — so
// `0` is the only answer a pose can give.
//
// WHY THIS IS A POINT OF ITS OWN RATHER THAN A REPETITION OF `board/load-board-carries-the-tokens`.
// That point poses a board and reads the kinds, cuts and strains back. This one
// poses a board OVER A FALLEN ONE. A build that writes the notation faithfully
// but carries the figures the previous board was holding answers a pose from rest
// perfectly well and fails here — and if it did, every `fell` reading elsewhere on
// this checklist would be reading the fixture the check posed rather than the
// fall the build performed. So the scenario drives a real step FIRST, proves the
// board in front of the pose is carrying a non-zero `fell`, and only then writes
// over it.
//
// THE STEP THAT DIRTIES THE BOARD. A vertical run of three rubies at the foot of
// column 4, completed by trading the parked ruby at (5,6) into (4,6). Its
// survivors fall three rows and its top three cells are refilled from above, so
// the board it leaves carries `fell` figures on nine of its cells and `lastFall`
// reports the greatest of them. Which step it is does not matter to the point,
// only that it left figures behind, and the check reads that rather than assuming
// it.
//
// WHAT IS WRITTEN OVER IT. A whole board through `loadBoard`, and then one cell
// through `setGem`, because the specification makes the same promise about each
// and a build can honor one and not the other. The single cell is written with a
// token no filler cell carries at that position, so the pose is proved to have
// landed before its `fell` is read.
//
// WHAT IS READ. Every one of the `GRID_COLS x GRID_ROWS` (64) cells, not a
// sample: the fault this is aimed at is a stale figure surviving a pose, and a
// stale figure survives in the cells the previous fall touched rather than in the
// ones a check would think to look at.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { GRID_COLS, GRID_ROWS } from "../constants";
import {
  clearSetFromRuns,
  maximalRuns,
  quietRowsWith,
  swapped,
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
import type { FacetSnapshot } from "../surface";

/** The column the dirtying step clears the foot of. */
const COL = 4;

/**
 * Three rubies that make a vertical run at the foot of column 4 once the parked
 * one trades in from next door: a step whose survivors fall and whose top cells
 * are refilled, so the board it leaves is carrying figures to be written over.
 */
const SCENARIO: readonly PlacedToken[] = [
  { col: COL, row: 5, token: "R0" },
  { col: COL, row: 7, token: "R0" },
  { col: COL + 1, row: 6, token: "R0" },
];

/** The swap that completes the run: the parked ruby trades into `(4,6)`. */
const A: CellRef = { col: COL, row: 6 };
const B: CellRef = { col: COL + 1, row: 6 };

/** The three cells the swap's run seeds, top to bottom. */
const CLEAR_SET: readonly CellRef[] = [
  { col: COL, row: 5 },
  { col: COL, row: 6 },
  { col: COL, row: 7 },
];

/** The cell written through `setGem`, and the token written into it. */
const WRITTEN: CellRef = { col: 2, row: 5 };
const WRITTEN_TOKEN = "M2b";

/** Every cell of a reading whose `fell` is not `0`. */
function movedCells(snapshot: FacetSnapshot): string[] {
  return snapshot.board.cells
    .filter((cell) => cell.fell !== 0)
    .map((cell) => `(${cell.col},${cell.row}):${cell.fell}`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reports 0 in every cell of a board written over a fallen one", async () => {
  const posed = quietRowsWith(SCENARIO);
  // The arrangement is proved rather than assumed: the posed board carries no
  // run of its own, and the swap's run seeds exactly the three cells at the foot
  // of column 4 — a clear whose survivors fall and whose cells are refilled.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertDeepEqual(
    clearSetFromRuns(swapped(posed, A, B)),
    CLEAR_SET,
    "the clear set the swap produces",
  );

  loadBoard(h, posed);
  const fallen = await swapAndStep(h, A, B);
  assertEqual(fallen.chainStep, 1, "the chain step the swap opened");

  // The premise this whole point rests on: the board the pose is about to be
  // written over really is carrying figures a fall left on it. Without this the
  // reading below could be satisfied by a build that never reports anything.
  assertGreaterThan(
    movedCells(fallen).length,
    0,
    "cells reporting a non-zero fell on the board the step settled",
  );
  assertGreaterThan(
    fallen.lastFall,
    0,
    "the greatest fell the settled board reports",
  );

  // A whole board written over it. specs/instrumentation.md has `loadBoard` pose
  // the board "standing still where it was written", so nothing of the fall may
  // survive the call.
  const written = quietRowsWith([]);
  loadBoard(h, written);
  h.debug.setGem(WRITTEN.col, WRITTEN.row, WRITTEN_TOKEN);
  await h.advance(1);
  captureStill(h, "posed");

  const after = h.snapshot();
  // The pose landed: the cell `setGem` wrote holds the gem the token names, so
  // the `fell` read at it is a reading of that write rather than of a cell the
  // call never reached.
  const single = after.board.cells.filter(
    (cell) => cell.col === WRITTEN.col && cell.row === WRITTEN.row,
  );
  assertLength(single, 1, `cells reported at (${WRITTEN.col},${WRITTEN.row})`);
  assertEqual(single[0].cut, "brilliant", "the cut setGem wrote");
  assertEqual(single[0].strain, 2, "the strain setGem wrote");
  assertEqual(single[0].kind, "amethyst", "the kind setGem wrote");

  // And every one of the 64 cells, the ones the fall had moved included, is
  // standing still.
  assertLength(
    after.board.cells,
    GRID_COLS * GRID_ROWS,
    "cells the posed board reports",
  );
  assertDeepEqual(movedCells(after), [], "cells reporting a non-zero fell");
});
