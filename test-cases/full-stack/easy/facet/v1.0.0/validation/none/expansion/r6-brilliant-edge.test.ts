// expansion/r6-brilliant-edge — a brilliant cleared against a board edge adds
// only those of its eight surrounding cells that lie on the board.
//
// specs/rules.md R6, first addition, carries the clause this point is about:
// each of the eight cells surrounding the brilliant "that lies on the board".
// The eight are the geometric neighborhood, not a promise that eight cells
// exist — against an edge five of them do, and at a corner three.
//
// The failure this rules out is a build that reaches past the edge and lands
// somewhere: a column index taken modulo `GRID_COLS` wraps a brilliant at column
// 0 onto column 7, and a clamp folds the missing cells back onto ones already in
// the set. Both are invisible to a count alone, so the check reads where every
// surviving gem came to rest as well: a wrap takes gems out of the far column,
// and R9 drops what is left of that column into places this scenario says are
// impossible.
//
// TWO PLACEMENTS, one per `it`. A brilliant at column 0 in the middle of the
// board has five surrounding cells on the board, so a run of three completed
// across it clears seven. A brilliant in the bottom-left corner has three, so
// the same run clears five. Both runs are exactly three long, leaving R8 with
// nothing to create, and no gem anywhere on either board is flawed or cut, so
// nothing but the first addition can grow either seed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { GRID_COLS, GRID_ROWS, type GemKind } from "../constants";
import {
  maximalRuns,
  parseToken,
  quietRowsWith,
  ring,
  swapped,
  tokenAt,
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
import type { FacetSnapshot } from "../surface";

/** The cells of `cells`, each named once, in the order they were given in. */
function distinct(cells: readonly CellRef[]): CellRef[] {
  const seen = new Set<string>();
  return cells.filter(({ col, row }) => {
    const key = `${col},${row}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The kind standing at one cell of a written board; `null` is a prism. */
function kindAt(rows: BoardRows, col: number, row: number): GemKind | null {
  return parseToken(tokenAt(rows, col, row)).kind;
}

/**
 * Where every gem the step did NOT take must stand once R9 has settled the
 * board.
 *
 * R9 drops each column's survivors to the lowest empty cells below them, keeping
 * the order the column held them in, so a survivor's resting row counts how many
 * cells above it were emptied. That is what makes an emptying readable at all: a
 * step puts the board back together before it ends, so no reading catches a cell
 * while it stands empty.
 *
 * Kinds alone. Strain is R7's business and a cut is R8's, and neither belongs to
 * this point. The cells above the survivors hold R9's refill, drawn from the
 * game's own random draw, and nothing here reads them.
 */
function restingKinds(
  before: BoardRows,
  cleared: readonly CellRef[],
): { col: number; row: number; kind: GemKind | null }[] {
  const taken = new Set(cleared.map(({ col, row }) => `${col},${row}`));
  const resting: { col: number; row: number; kind: GemKind | null }[] = [];
  for (let col = 0; col < GRID_COLS; col += 1) {
    const standing: (GemKind | null)[] = [];
    for (let row = 0; row < GRID_ROWS; row += 1) {
      if (!taken.has(`${col},${row}`)) standing.push(kindAt(before, col, row));
    }
    const top = GRID_ROWS - standing.length;
    standing.forEach((kind, index) => {
      resting.push({ col, row: top + index, kind });
    });
  }
  return resting;
}

/**
 * Frames recorded after the step has resolved, so the replay shows the clear set
 * shattering and the board falling in behind it.
 *
 * `swapAndStep` leaves the step `0.03875` s into its own hold; twelve more frames
 * of the suite's 64 Hz clock add `0.1875` s, for `0.22625` s in all. That is
 * short of `0.3` s, the SHORTEST hold any step can have, so the board is never
 * read a second time and every assertion is made against the reading the drive
 * returned.
 */
const REPLAY_FRAMES = 12;

/**
 * Pose `posed`, exchange `from` with `to`, and hold the step that resolves to
 * the cells `cleared` names and no others.
 *
 * The two placements below differ only in where the brilliant stands, so the
 * drive and the two readings are written once. `outputId` is the review item's
 * declared output, and the second placement passes `null` rather than writing a
 * second recording over the first.
 */
async function clearsExactly(
  posed: BoardRows,
  from: CellRef,
  to: CellRef,
  cleared: readonly CellRef[],
  outputId: string | null,
): Promise<void> {
  const exchanged = swapped(posed, from, to);
  // The fixture, established before the build is asked anything: the posed board
  // carries no run, and the exchange makes exactly one of exactly three cells,
  // so R8 creates nothing and the seed is that run.
  assertLength(maximalRuns(posed), 0, "runs on the posed board");
  assertLength(maximalRuns(exchanged), 1, "runs the exchange makes");
  assertLength(maximalRuns(exchanged)[0].cells, 3, "the length of that run");

  await loadBoard(h, posed);

  const drive = async (): Promise<{
    reading: FacetSnapshot;
    settled: string[];
  }> => {
    const reading = await swapAndStep(h, from, to);
    const board = await h.board();
    await h.advance(REPLAY_FRAMES);
    return { reading, settled: board };
  };
  const step =
    outputId === null ? await drive() : await captureReplay(h, outputId, drive);

  assertEqual(
    step.reading.phase,
    "resolving",
    "phase after the swap animation",
  );
  assertEqual(step.reading.chainStep, 1, "the step the reading describes");
  assertEqual(step.reading.lastCleared, cleared.length, "cells the step took");

  // Which cells they were. A build that wrapped or clamped the ring took gems
  // from a column this scenario leaves untouched, and the survivors of that
  // column come to rest a row too low.
  for (const { col, row, kind } of restingKinds(exchanged, cleared)) {
    assertEqual(
      kindAt(step.settled, col, row),
      kind,
      `the kind resting at (${col},${row}) once the step settled`,
    );
  }
}

/* The brilliant against the left edge: five of its eight cells are on board. */

const EDGE_BRILLIANT: CellRef = { col: 0, row: 4 };
const EDGE_RUN: readonly CellRef[] = [
  EDGE_BRILLIANT,
  { col: 1, row: 4 },
  { col: 2, row: 4 },
];
const EDGE_FROM: CellRef = { col: 2, row: 3 };
const EDGE_TO: CellRef = { col: 2, row: 4 };
const EDGE_POSED: BoardRows = quietRowsWith([
  { col: EDGE_BRILLIANT.col, row: EDGE_BRILLIANT.row, token: "R0b" },
  { col: 1, row: 4, token: "R0" },
  { col: EDGE_FROM.col, row: EDGE_FROM.row, token: "R0" },
]);

/* The brilliant in the bottom-left corner: three of its eight are on board. */

const CORNER_BRILLIANT: CellRef = { col: 0, row: 7 };
const CORNER_RUN: readonly CellRef[] = [
  CORNER_BRILLIANT,
  { col: 1, row: 7 },
  { col: 2, row: 7 },
];
const CORNER_FROM: CellRef = { col: 2, row: 6 };
const CORNER_TO: CellRef = { col: 2, row: 7 };
const CORNER_POSED: BoardRows = quietRowsWith([
  { col: CORNER_BRILLIANT.col, row: CORNER_BRILLIANT.row, token: "R0b" },
  { col: 1, row: 7, token: "R0" },
  { col: CORNER_FROM.col, row: CORNER_FROM.row, token: "R0" },
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the five on-board cells around a brilliant at the left edge", async () => {
  // `ring` lists the surrounding cells that lie on the board, which at column 0
  // is five: the three in column 1 and the two above and below in column 0. One
  // of the five is the run's own middle cell, so the set is seven.
  const cleared = distinct([...EDGE_RUN, ...ring(0, 4)]);
  assertLength(ring(0, 4), 5, "surrounding cells on the board at column 0");
  assertLength(cleared, 7, "the run and the on-board ring, counted once each");

  await clearsExactly(EDGE_POSED, EDGE_FROM, EDGE_TO, cleared, "clear");
});

it("takes the three on-board cells around a brilliant in a corner", async () => {
  // At a corner only three of the eight lie on the board, and one of those three
  // is the run's middle cell, so the whole step takes five cells.
  const cleared = distinct([...CORNER_RUN, ...ring(0, 7)]);
  assertLength(ring(0, 7), 3, "surrounding cells on the board at a corner");
  assertLength(cleared, 5, "the run and the on-board ring, counted once each");

  await clearsExactly(CORNER_POSED, CORNER_FROM, CORNER_TO, cleared, null);
});
