// runs/r4-horizontal-run — a swap that puts MATCH_MIN gems of one kind on
// consecutive cells of a single ROW clears exactly those three cells.
//
// R4 of specs/rules.md fixes both halves of the sentence, and this point is
// about both. A run is `MATCH_MIN` (3) or more gems of one kind on consecutive
// cells of a single row or a single column, so three in a row is a run at all;
// and R5 seeds the step with the union of every maximal run, so the step takes
// those three cells and, with nothing else on the board matching, nothing
// flawed, and no cut in play, nothing besides them.
//
// WHY THE BOARD IS POSED RATHER THAN PLAYED INTO. The filler under this scenario
// carries no maximal run and no legal swap of its own (`quietBoard`), so the only
// match anywhere is the one the scenario wrote, and the only move is the one it
// asks for. Whatever the step does is therefore attributable to the three rubies
// and to nothing that happened to be dealt.
//
// WHAT THIS POINT READS. The three cells the run stands on are what the item
// claims, so the check reads the three COLUMNS they stand in and nothing else:
// under R9 each of those columns closes over exactly one cell, which happens
// only if the step took that column's cell of the run. Every other column is
// left unread, because nothing the item claims is written there.
//
// AND WHY R7 IS KEPT OUT OF THE READING ENTIRELY. R7 raises the strain of the
// gems the clear set stands beside, and which gems those are is `strain/*`'s
// point rather than this one. R7 alters strain and alters neither kind nor cut,
// so a gem that stood anywhere in the clear set's eight-cell ring is read by its
// KIND alone here, and only a gem the clear set stood nowhere near is read as a
// whole token. A build's reading of R7 therefore cannot decide this point, and a
// build that gets R7 wrong loses R7's points rather than this one as well.
//
// The run is exactly three, which R8's table creates nothing from, so no created
// gem is in play either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { GRID_ROWS, MATCH_MIN } from "../constants";
import {
  assertBoardEquals,
  maskBoard,
  maximalRuns,
  parseToken,
  quietRowsWith,
  renderBoard,
  ring,
  swapped,
  tokenAt,
  withCells,
  type CellRef,
  type PlacedToken,
} from "../board";
import {
  captureReplay,
  createHarness,
  loadBoard,
  swap,
  type Harness,
} from "../harness";

/** The row the run lands on, and the three columns it spans. */
const RUN_ROW = 4;
const RUN_COLS = [2, 3, 4];
const RUN_CELLS: CellRef[] = RUN_COLS.map((col) => ({ col, row: RUN_ROW }));

/** The swap: the ruby a row above drops between the two already in place. */
const FROM: CellRef = { col: 3, row: RUN_ROW - 1 };
const TO: CellRef = { col: 3, row: RUN_ROW };

/**
 * Three rubies over the quiet filler: two flanking the gap at `(2,4)` and
 * `(4,4)`, and the third parked one row above the gap.
 *
 * Nothing here is a run yet — the gap holds the filler's own beryl — and the
 * cells immediately beyond the run's two ends hold a citrine and an amethyst, so
 * the run the swap makes is maximal at three rather than a piece of a longer one.
 */
const POSED = quietRowsWith([
  { col: RUN_COLS[0], row: RUN_ROW, token: "R0" },
  { col: RUN_COLS[2], row: RUN_ROW, token: "R0" },
  { col: FROM.col, row: FROM.row, token: "R0" },
]);

/** The board the exchange produces, which is what R4 and R5 are read over. */
const AFTER = swapped(POSED, FROM, TO);

/**
 * Whether the clear set stands beside a cell, at an edge or at a corner.
 *
 * The gems R7 can reach are among these, whatever adjacency a build reads the
 * rule with, so a gem that stood here crosses the step with a strain this point
 * does not read.
 */
function besideRun(cell: CellRef): boolean {
  return ring(cell.col, cell.row).some((around) =>
    RUN_CELLS.some((run) => run.col === around.col && run.row === around.row),
  );
}

/**
 * Every survivor of the run's own columns, paired with the cell R9 left it
 * standing in.
 *
 * R9 drops every survivor to the lowest empty cell below it, keeping its
 * column's order. Exactly one cell of each of these columns was emptied, so
 * every gem above the run's row stands one row lower afterward and every gem
 * below it stands where it stood. The one cell of each column that holds no
 * survivor afterward is row `0`, which R9 refilled off the game's own generator,
 * and no check may assert what landed there.
 */
const SETTLED: { from: CellRef; at: CellRef }[] = [];
for (const col of RUN_COLS) {
  for (let row = 0; row < GRID_ROWS; row += 1) {
    if (row === RUN_ROW) continue;
    const at = row < RUN_ROW ? row + 1 : row;
    SETTLED.push({ from: { col, row }, at: { col, row: at } });
  }
}

/** The survivors the clear set never stood beside, read as whole tokens. */
const TOKENS: PlacedToken[] = SETTLED.filter(
  ({ from }) => !besideRun(from),
).map(({ from, at }) => ({
  col: at.col,
  row: at.row,
  token: tokenAt(AFTER, from.col, from.row),
}));

/** The survivors the clear set stood beside, read by kind alone. */
const KINDS: PlacedToken[] = SETTLED.filter(({ from }) => besideRun(from)).map(
  ({ from, at }) => ({
    col: at.col,
    row: at.row,
    token: tokenAt(AFTER, from.col, from.row),
  }),
);

/**
 * Frames driven after the swap purely so the recorded clip holds motion.
 *
 * Short of `STEP_SECONDS` (0.25 s, 16 frames of the suite's 64 Hz clock), so the
 * board is never read a second time and the clip shows step 1 alone. Every
 * assertion is made against the reading taken before them.
 */
const CLIP_FRAMES = 12;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the three cells a swap lines up along one row", async () => {
  // The fixture states its own premises before the build is asked anything, so a
  // scenario that stopped posing what it claims fails as a fixture rather than
  // as a verdict about the build.
  assertLength(maximalRuns(POSED), 0, "maximal runs on the posed board");
  const runs = maximalRuns(AFTER);
  assertLength(runs, 1, "maximal runs the swap produces");
  assertTrue(runs[0].horizontal, "the run lies along a row");
  assertLength(runs[0].cells, MATCH_MIN, "cells in the run");

  loadBoard(h, POSED);

  const first = await captureReplay(h, "clear", async () => {
    const reading = swap(h, FROM, TO);
    await h.advance(CLIP_FRAMES);
    return reading;
  });

  // An accepted swap resolves step 1 on the spot, so this reading IS the step.
  assertEqual(first.lastCleared, MATCH_MIN, "cells the step cleared");

  // And the run's three columns say which three cells went: each of them closed
  // over its own cell of the run, and over that cell alone.
  const board = renderBoard(first);
  assertBoardEquals(
    board,
    withCells(maskBoard(AFTER, []), TOKENS),
    "the run's own columns",
  );
  for (const cell of KINDS) {
    assertEqual(
      parseToken(tokenAt(board, cell.col, cell.row)).kind,
      parseToken(cell.token).kind,
      `the kind standing at (${cell.col},${cell.row})`,
    );
  }
});
