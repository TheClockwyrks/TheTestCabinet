// settling/r9-refill-falls-from-above — a fresh gem travels in from above the
// board rather than appearing in the cell it fills.
//
// WHAT THE RULE IS. specs/rules.md gives R9 a table with four rows, and this
// point owns the last: "A gem the refill dealt into row `r` — At least `r + 1`",
// with the sentence that follows it as the reason — "A refilled gem comes from
// above the board's top row, so `r + 1` rows is the least it can have traveled."
// A cell at row 0 is one row below the first cell above the board, a cell at row
// 2 is three, and so on down the column.
//
// ONLY THE FLOOR IS ASSERTED, AND THAT IS THE RULE RATHER THAN A CONCESSION.
// specs/rules.md hands the figure above `r + 1` to the build in the next
// sentence: "Which figure at or above that each refilled gem carries is the
// build's, and it is what decides the shape a column fills in." A build that
// deals its refill in from one row above the board and one that deals it in from
// four rows above are both conformant, and they fill a column with visibly
// different timing. So an exact expectation written against a refill would fail a
// conforming build for a choice the specification gave it. `board.ts` is what
// makes that impossible to write by accident: `settle` gives a refilled cell an
// `{ atLeast }` rather than an `{ exactly }`, and `assertFell` reads the union it
// is handed, so this check asserts the floor because the floor is the only shape
// the oracle offers.
//
// TELLING A REFILL FROM A SURVIVOR. R9 refills "with a `plain` gem at strain
// `0`", so every survivor in the columns these arrangements clear is posed at
// strain 2 — a mark that changes the strain digit alone, each cell keeping the
// kind the run-free filler put there, so no mark can make or break a run. Strain
// 2 is short of `MAX_STRAIN`, so no mark is a flawed gem R6 would pull into the
// clear set, and R6 runs before R7 does, so a mark R7 later raises to `MAX_STRAIN`
// was not flawed when the set was grown. Every cell the refill dealt therefore
// stands out at strain 0, and the check reads that before it reads the cell's
// `fell` — a build whose refill landed somewhere other than the top of its column
// fails saying which cell it was looking at.
//
// TWO ARRANGEMENTS, BECAUSE THE FLOOR IS PER CELL AND PER COLUMN. The first
// empties three cells out of ONE column — the whole foot of column 4 — so its
// top three cells are refills owing at least 1, at least 2 and at least 3: a
// build that reports one constant for every fresh gem is caught at the second of
// them. The second empties ONE cell out of each of THREE columns, so the rule is
// read where several columns each want a single cell at row 0.
//
// WHEN EACH READING IS TAKEN. An accepted swap exchanges the two cells at once
// and then holds them in motion: specs/rules.md sets `phase` to `swapping` with
// `chainStep` at 0, and step 1 resolves once `SWAP_SECONDS` (0.18) of game time
// has passed. `swapAndStep` carries the board through exactly that and hands back
// the reading step 1 left behind, refill included.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { GRID_ROWS, MAX_STRAIN } from "../constants";
import {
  assertFell,
  clearSetFromRuns,
  fellAt,
  isFlawed,
  maximalRuns,
  parseToken,
  quietBoard,
  quietRowsWith,
  settle,
  showFell,
  swapped,
  tokenAt,
  tokenOf,
  type BoardRows,
  type CellRef,
  type PlacedToken,
  type Settlement,
} from "../board";
import {
  captureReplay,
  createHarness,
  framesShortOf,
  loadBoard,
  swapAndStep,
  type Harness,
} from "../harness";
import type { CellSnapshot, FacetSnapshot } from "../surface";

/**
 * The strain every survivor of a cleared column is posed at.
 *
 * One short of `MAX_STRAIN`: high enough that no refill can carry it, low enough
 * that the gem is not flawed when R6 grows the clear set.
 */
const MARK_STRAIN = MAX_STRAIN - 1;

/**
 * Every cell of `cols` from the top down to `lastRow`, at {@link MARK_STRAIN},
 * keeping the kind the run-free filler already holds there.
 *
 * Computed rather than written out, because the mark is a strain digit and
 * nothing else: writing the tokens by hand would put seven kinds in the fixture
 * that no assertion is about, and a kind copied wrongly would plant a run.
 */
function markedColumns(
  cols: readonly number[],
  lastRow: number,
): PlacedToken[] {
  const filler = quietBoard();
  const marks: PlacedToken[] = [];
  for (const col of cols) {
    for (let row = 0; row <= lastRow; row += 1) {
      marks.push({
        col,
        row,
        token: tokenOf(parseToken(tokenAt(filler, col, row)).kind, MARK_STRAIN),
      });
    }
  }
  return marks;
}

/** The column the first arrangement clears three cells out of. */
const DEEP_COL = 4;

/**
 * The first arrangement: a vertical run of three rubies at the foot of column 4,
 * with every survivor above it marked.
 */
const DEEP_SCENARIO: readonly PlacedToken[] = [
  ...markedColumns([DEEP_COL], 4),
  { col: DEEP_COL, row: 5, token: "R0" },
  { col: DEEP_COL, row: 7, token: "R0" },
  { col: DEEP_COL + 1, row: 6, token: "R0" },
];

/** The swap that completes it: the parked ruby trades into `(4,6)`. */
const DEEP_A: CellRef = { col: DEEP_COL, row: 6 };
const DEEP_B: CellRef = { col: DEEP_COL + 1, row: 6 };

/** The cells that run seeds. */
const DEEP_CLEAR_SET: readonly CellRef[] = [
  { col: DEEP_COL, row: 5 },
  { col: DEEP_COL, row: 6 },
  { col: DEEP_COL, row: 7 },
];

/** The columns the second arrangement clears one cell out of, at row 7. */
const WIDE_COLS: readonly number[] = [3, 4, 5];

/**
 * The second arrangement: a horizontal run of three jades along the foot of the
 * board, with every survivor of those three columns marked.
 *
 * The jade at `(4,6)` is the one the swap carries down into the run, and it is
 * marked like the rest: the gem it trades places with is a survivor too, and it
 * arrives at `(4,6)` carrying the strain it was posed with.
 */
const WIDE_SCENARIO: readonly PlacedToken[] = [
  ...markedColumns(WIDE_COLS, GRID_ROWS - 1),
  { col: 5, row: 7, token: "J0" },
  { col: 4, row: 6, token: tokenOf("jade", MARK_STRAIN) },
];

/** The swap that completes it: the parked jade drops into `(4,7)`. */
const WIDE_A: CellRef = { col: 4, row: 6 };
const WIDE_B: CellRef = { col: 4, row: 7 };

/** The cells that run seeds. */
const WIDE_CLEAR_SET: readonly CellRef[] = WIDE_COLS.map((col) => ({
  col,
  row: 7,
}));

/**
 * Frames that carry the recording to just short of the end of the step the
 * reading was taken in, so the replay holds the fresh gems arriving rather than
 * stopping on the frame the step resolved.
 *
 * A step's hold is the STEP's OWN figure — `lastWaves * WAVE_SECONDS` plus
 * `lastFall * FALL_SECONDS_PER_ROW` plus `STEP_SECONDS` — which the snapshot
 * reports as `stepHold`, so the frames that fill it are read off the reading
 * rather than written down. `framesShortOf` keeps the drive strictly inside what
 * is left of that hold, so the board is never read a second time and every
 * figure asserted below still describes step 1.
 */
function restOfStep(reading: FacetSnapshot): number {
  return framesShortOf(Math.max(0, reading.stepHold - reading.stepTimer));
}

/** The one cell a snapshot reports at `(col, row)`. */
function cellAt(
  snapshot: FacetSnapshot,
  col: number,
  row: number,
): CellSnapshot {
  const found = snapshot.board.cells.filter(
    (cell) => cell.col === col && cell.row === row,
  );
  assertLength(found, 1, `cells reported at (${col},${row})`);
  return found[0];
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Establish that one arrangement really poses what its comment claims, and hand
 * back R9's own answer for the board the swap produces.
 *
 * Checked before the build is asked anything, so a scenario that drifted is
 * reported as a fixture fault rather than travelling into the build. Every
 * survivor of a cleared column is proved to be marked and unflawed, which is what
 * makes "this cell is at strain 0, so it is a refill" a reading rather than an
 * assumption.
 */
function stepOf(
  posed: BoardRows,
  a: CellRef,
  b: CellRef,
  cleared: readonly CellRef[],
  cols: readonly number[],
  what: string,
): Settlement {
  assertLength(
    maximalRuns(posed),
    0,
    `maximal runs on the posed ${what} board`,
  );
  const resolved = swapped(posed, a, b);
  assertDeepEqual(
    clearSetFromRuns(resolved),
    [...cleared],
    `the clear set the ${what} swap produces`,
  );
  for (const col of cols) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      if (cleared.some((cell) => cell.col === col && cell.row === row))
        continue;
      const strain = parseToken(tokenAt(resolved, col, row)).strain;
      assertEqual(
        strain,
        MARK_STRAIN,
        `the strain the ${what} survivor at (${col},${row}) is posed at`,
      );
      assertEqual(
        isFlawed(strain),
        false,
        `whether the ${what} survivor at (${col},${row}) is flawed when R6 runs`,
      );
    }
  }
  return settle(resolved, cleared);
}

/**
 * Every refilled cell of one settlement, held to the floor R9 fixes for it.
 *
 * The cell is read for strain 0 first, so a build whose refill landed somewhere
 * other than the top of its column is reported as having refilled the wrong cell
 * rather than as having reported the wrong distance.
 */
function assertRefillsFellFromAbove(
  snapshot: FacetSnapshot,
  settlement: Settlement,
  what: string,
): void {
  for (const cell of settlement.refilled) {
    const where = `the ${what} refill at (${cell.col},${cell.row})`;
    const owed = fellAt(settlement, cell.col, cell.row);
    // The fixture's own last premise: what R9 fixes for this cell is the floor
    // `r + 1` and not a figure, so what is asserted below is a bound.
    assertEqual(
      showFell(owed),
      `at least ${cell.row + 1}`,
      `the floor R9 fixes for ${where}`,
    );
    const gem = cellAt(snapshot, cell.col, cell.row);
    assertEqual(
      gem.strain,
      0,
      `the strain of ${where}, which is what marks it a refill`,
    );
    assertFell(gem.fell, owed, `the rows ${where} traveled`);
  }
}

it("brings every refilled gem in from above the board's top row", async () => {
  const deep = quietRowsWith(DEEP_SCENARIO);
  const deepSettlement = stepOf(
    deep,
    DEEP_A,
    DEEP_B,
    DEEP_CLEAR_SET,
    [DEEP_COL],
    "deep",
  );
  // Three cells left one column, so its top three are refills owing at least 1,
  // at least 2 and at least 3 — a range rather than a single figure, which is
  // what catches a build that answers every fresh gem with one constant.
  assertDeepEqual(
    deepSettlement.refilled.map((cell) => `${cell.col},${cell.row}`),
    ["4,0", "4,1", "4,2"],
    "the cells the deep step refills",
  );

  await loadBoard(h, deep);
  const afterDeep = await captureReplay(h, "refill", async () => {
    const first = await swapAndStep(h, DEEP_A, DEEP_B);
    await h.advance(restOfStep(first));
    return first;
  });
  assertEqual(afterDeep.chainStep, 1, "the chain step the deep swap opened");
  assertRefillsFellFromAbove(afterDeep, deepSettlement, "deep");

  // The same floor where three columns each want one cell at row 0.
  const wide = quietRowsWith(WIDE_SCENARIO);
  const wideSettlement = stepOf(
    wide,
    WIDE_A,
    WIDE_B,
    WIDE_CLEAR_SET,
    WIDE_COLS,
    "wide",
  );
  assertDeepEqual(
    wideSettlement.refilled.map((cell) => `${cell.col},${cell.row}`),
    ["3,0", "4,0", "5,0"],
    "the cells the wide step refills",
  );

  await loadBoard(h, wide);
  const afterWide = await swapAndStep(h, WIDE_A, WIDE_B);
  assertEqual(afterWide.chainStep, 1, "the chain step the wide swap opened");
  assertRefillsFellFromAbove(afterWide, wideSettlement, "wide");
});
