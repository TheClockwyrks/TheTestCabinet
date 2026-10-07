// expansion/r6-flawed-adjacent-taken — a flawed gem orthogonally beside the
// clear set goes with it.
//
// specs/rules.md R6, third addition: "every flawed gem orthogonally adjacent to
// a cell in the set". specs/board.md fixes what flawed means — strain
// `MAX_STRAIN` (`3`) — and specs/rules.md R1 fixes what orthogonally adjacent
// means: a difference of `1` in column and `0` in row, or `0` and `1`.
//
// THE OTHER DIRECTION IS ITS OWN POINT. That a flawed gem touching the set at a
// corner alone is NOT taken is `expansion/r6-flawed-diagonal-stands`, because a
// build that reaches diagonally passes this point and fails that one, and a
// build that ignores the third addition altogether fails this one and passes
// that one.
//
// THE SCENARIO. A run of three rubies is completed across the middle of the
// board with one flawed citrine directly ABOVE the run's middle cell, of a kind
// other than the run's so it cannot lengthen it. Every other gem on the board is
// plain at strain 0, so no brilliant and no star can grow the set, and the run
// is exactly three long, so R8 creates nothing. The clear set is the three cells
// of the run plus the one flawed gem above it: four.
//
// `lastCleared` is 4 rather than 3, and the citrine's cell is emptied — reported
// by the gems that fell into its column over it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { GRID_COLS, GRID_ROWS, MAX_STRAIN, type GemKind } from "../constants";
import {
  areAdjacent,
  maximalRuns,
  parseToken,
  quietRowsWith,
  strainAt,
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

/** The run of three the swap completes. */
const RUN: readonly CellRef[] = [
  { col: 2, row: 4 },
  { col: 3, row: 4 },
  { col: 4, row: 4 },
];

/** The flawed gem orthogonally above the run's middle cell. */
const ORTHOGONAL: CellRef = { col: 3, row: 3 };

/** The two cells the swap exchanges: the third ruby rises into the run. */
const FROM: CellRef = { col: 3, row: 5 };
const TO: CellRef = { col: 3, row: 4 };

/**
 * The board the scenario is posed on. The flawed gem keeps the filler's own kind
 * at its cell and differs from it in strain alone, so it can neither make nor
 * lengthen a run.
 */
const POSED: BoardRows = quietRowsWith([
  { col: 2, row: 4, token: "R0" },
  { col: 4, row: 4, token: "R0" },
  { col: FROM.col, row: FROM.row, token: "R0" },
  { col: ORTHOGONAL.col, row: ORTHOGONAL.row, token: "C3" },
]);

/** The board the exchange itself produces, which is what the step reads. */
const EXCHANGED: BoardRows = swapped(POSED, FROM, TO);

/** The seed plus the one flawed gem orthogonally beside it. */
const CLEARED: readonly CellRef[] = distinct([...RUN, ORTHOGONAL]);

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes a flawed gem orthogonally beside the set", async () => {
  // The fixture. The posed board holds no run; the exchange makes exactly one,
  // three cells long. The placed gem is at MAX_STRAIN, so it is flawed, and it
  // is orthogonally adjacent to a cell of the run.
  assertLength(maximalRuns(POSED), 0, "runs on the posed board");
  assertLength(maximalRuns(EXCHANGED), 1, "runs the exchange makes");
  assertLength(maximalRuns(EXCHANGED)[0].cells, 3, "the length of that run");
  assertEqual(
    strainAt(EXCHANGED, ORTHOGONAL.col, ORTHOGONAL.row),
    MAX_STRAIN,
    "the strain of the gem above the run",
  );
  assertEqual(
    CLEARED.some((cell) => areAdjacent(cell, ORTHOGONAL)),
    true,
    "the flawed citrine touches the set orthogonally",
  );

  loadBoard(h, POSED);

  const step = await captureReplay(h, "clear", async () => {
    const reading = await swapAndStep(h, FROM, TO);
    const settled = h.board();
    await h.advance(REPLAY_FRAMES);
    return { reading, settled };
  });

  assertEqual(
    step.reading.phase,
    "resolving",
    "phase after the swap animation",
  );
  assertEqual(step.reading.chainStep, 1, "the step the reading describes");

  // Three cells of run and one flawed neighbor: four, not the three a build that
  // ignored the third addition would report.
  assertEqual(step.reading.lastCleared, CLEARED.length, "cells the step took");

  // And the flawed gem is gone: column 3 lost two cells rather than one, so
  // its survivors rest two rows lower than the columns that lost only the run.
  for (const { col, row, kind } of restingKinds(EXCHANGED, CLEARED)) {
    assertEqual(
      kindAt(step.settled, col, row),
      kind,
      `the kind resting at (${col},${row}) once the step settled`,
    );
  }
});
