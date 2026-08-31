// settling/r9-refill-plain-zero — what R9 drops into the cells the fall left
// empty is an ordinary gem: plain, at strain 0, of one of the seven kinds.
//
// WHAT THE RULE IS. specs/rules.md R9: "Each cell still empty is then filled from
// the top of its column with a `plain` gem at strain `0`, whose kind is drawn
// uniformly from `GEM_KINDS`". Three separate claims, and all three are read
// here: the cut is `plain`, the strain is `0`, and the kind is one of the seven
// specs/board.md names. The KIND ITSELF is not read and must not be — it comes
// off the game's own seeded generator, and asserting which one landed would fail
// every build but the one the check was written against.
//
// WHERE the refill goes is the fourth claim, and it is what the marks are for.
// The survivors in every column this scenario clears are posed at a strain the
// refill cannot have, so "the top of its column" is decidable: a build that
// filled the gap from the FOOT instead would leave a marked survivor at the top
// of the column, and a marked gem is not at strain 0.
//
// TWO ARRANGEMENTS, BECAUSE THE RULE IS PER COLUMN AND PER CELL. The first
// empties three cells out of ONE column — the whole foot of column 4 — so the top
// three cells of that column are all refills and a build that filled only the
// topmost one is caught. The second empties ONE cell out of each of THREE columns
// — a run along the foot of the board — so the rule is read where several columns
// need a single cell each.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength, fail } from "../assert";
import { GEM_KINDS } from "../constants";
import {
  clearSetFromRuns,
  maximalRuns,
  quietRowsWith,
  swapped,
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
import type { CellSnapshot, FacetSnapshot } from "../surface";

/** The column the first arrangement clears three cells out of. */
const DEEP_COL = 4;

/** How many cells that arrangement empties out of it. */
const DEEP_CLEARED = 3;

/**
 * The first arrangement: a vertical run of three at the foot of column 4, with
 * every survivor above it marked at strain 2.
 *
 * A mark changes the strain digit alone — each cell keeps the kind the run-free
 * filler put there — so no mark can make or break a run, and strain 2 is short of
 * `MAX_STRAIN`, so no mark is a flawed gem R6 would pull into the clear set.
 */
const DEEP_SCENARIO: readonly PlacedToken[] = [
  { col: DEEP_COL, row: 0, token: "B2" },
  { col: DEEP_COL, row: 1, token: "M2" },
  { col: DEEP_COL, row: 2, token: "A2" },
  { col: DEEP_COL, row: 3, token: "J2" },
  { col: DEEP_COL, row: 4, token: "S2" },
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
 * board, with the top cell of each of those columns marked at strain 2.
 */
const WIDE_SCENARIO: readonly PlacedToken[] = [
  { col: 3, row: 0, token: "J2" },
  { col: 4, row: 0, token: "B2" },
  { col: 5, row: 0, token: "S2" },
  { col: 5, row: 7, token: "J0" },
  { col: 4, row: 6, token: "J0" },
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
 * Frames driven after the swap purely so the replay carries the refill.
 *
 * Short of `STEP_SECONDS` (0.25 s, 16 frames of this clock), so the board is
 * never read a second time and the readings below still describe step 1.
 */
const REPLAY_FRAMES = 12;

let h: Harness;

/**
 * The seven kinds as plain strings, so the kind the BUILD reported can be tested
 * for membership rather than being taken on the union's word.
 */
const KIND_NAMES: readonly (string | null)[] = GEM_KINDS;

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

/** The three claims R9 makes about a cell it refilled. */
function assertRefill(snapshot: FacetSnapshot, col: number, row: number): void {
  const gem = cellAt(snapshot, col, row);
  const where = `the refill at (${col},${row})`;
  assertEqual(gem.cut, "plain", `the cut of ${where}`);
  assertEqual(gem.strain, 0, `the strain of ${where}`);
  if (!KIND_NAMES.includes(gem.kind)) {
    fail(
      `one of the seven kinds (${GEM_KINDS.join(", ")}) as ${where}`,
      gem.kind,
    );
  }
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fills every cell the fall left empty from the top, plain and at strain 0", async () => {
  const deep = quietRowsWith(DEEP_SCENARIO);
  // The arrangement is proved rather than assumed: no run stands on the posed
  // board, and the swap seeds exactly the three cells at the foot of column 4,
  // so exactly three cells of that column need refilling.
  assertLength(maximalRuns(deep), 0, "maximal runs on the posed deep board");
  assertDeepEqual(
    clearSetFromRuns(swapped(deep, DEEP_A, DEEP_B)),
    DEEP_CLEAR_SET,
    "the clear set the deep swap produces",
  );

  loadBoard(h, deep);
  const afterDeep = await captureReplay(h, "refill", async () => {
    const first = swap(h, DEEP_A, DEEP_B);
    await h.advance(REPLAY_FRAMES);
    return first;
  });
  assertEqual(afterDeep.chainStep, 1, "the chain step the deep swap opened");

  // Three cells left the column, so its top three cells are the fresh ones. The
  // marked survivors are all at strain 2 or worse, so a build that filled from
  // the foot fails on the strain of the very first of these.
  for (let row = 0; row < DEEP_CLEARED; row += 1) {
    assertRefill(afterDeep, DEEP_COL, row);
  }

  // The same rule where three columns each want one cell.
  const wide = quietRowsWith(WIDE_SCENARIO);
  assertLength(maximalRuns(wide), 0, "maximal runs on the posed wide board");
  assertDeepEqual(
    clearSetFromRuns(swapped(wide, WIDE_A, WIDE_B)),
    WIDE_CLEAR_SET,
    "the clear set the wide swap produces",
  );

  loadBoard(h, wide);
  const afterWide = swap(h, WIDE_A, WIDE_B);
  assertEqual(afterWide.chainStep, 1, "the chain step the wide swap opened");
  for (const col of WIDE_COLS) {
    assertRefill(afterWide, col, 0);
  }
});
