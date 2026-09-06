// settling/r9-fell-reports-the-drop — a gem R9 moved down says how far it came.
//
// WHAT THE RULE IS. specs/rules.md gives R9 a table with four rows, and this
// point owns the one for a gem the fall moved: "A surviving gem R9 moved down —
// Its new row less its old row". The figure rides on the gem, as `fell`, and
// specs/instrumentation.md reports it on every cell of the board.
//
// WHY IT IS A POINT OF ITS OWN, OVER `settling/r9-gems-fall`'S OWN SCENARIO. The
// FALL is that point: whether the survivors of a cleared column arrive at the
// right cells in the right order. What is read here is only the figure the fall
// left behind. Sharing the scenario is what separates the two cleanly — a build
// that settles a column correctly and reports nothing about the journey fails
// exactly one of the two, and a build that reports a figure it never moved a gem
// by fails the other.
//
// THE SCENARIO, THEREFORE, IS THAT ONE. A vertical run of three at the FOOT of
// column 4, rows 5 to 7, posed on the run-free filler and completed by trading
// the parked ruby at (5,6) into (4,6). The whole gap lies below every survivor,
// so R9's arithmetic gives all five of them the same answer — three rows, the
// drop the three emptied cells beneath them forced — and the filler makes the
// swap's run the only run on the board, so nothing else moves.
//
// EVERY SURVIVOR CARRIES A DIFFERENT KIND. Column 4 of the filler reads beryl,
// amethyst, amber, jade, sapphire down to the run, five kinds and no repeat, so
// each gem is followed to its new cell without ambiguity: the kind that arrived
// is asserted beside the `fell` it reports, and a reading that lost track of a
// cell fails naming the cell rather than passing on a gem it was not looking at.
//
// WHAT IS NOT READ. The strain of the survivor that stood against the clear set,
// which R7 raises and which is R7's point; and the `fell` of the three refilled
// cells at the top of the column, which R9 fixes only as a floor and which
// `settling/r9-refill-falls-from-above` decides. `board.ts`'s `settleBoard` is the
// oracle for both, and its `Fell` union is what keeps an exact expectation off a
// refill: only the five survivors are read here, and each of them carries an
// `exactly`.
//
// WHEN THE READING IS TAKEN. An accepted swap exchanges the two cells at once and
// then holds them in motion: specs/rules.md sets `phase` to `swapping` with
// `chainStep` at 0, and step 1 resolves once `SWAP_SECONDS` (0.18) of game time
// has passed. `swapAndStep` carries the board through exactly that and hands back
// the reading step 1 left behind, R9 included.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { GRID_ROWS } from "../constants";
import {
  assertFell,
  clearSetFromRuns,
  fellAt,
  maximalRuns,
  parseToken,
  quietRowsWith,
  settleBoard,
  showFell,
  swapped,
  tokenAt,
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
import type { CellSnapshot, FacetSnapshot } from "../surface";

/** The column whose foot the step clears, and whose survivors are then read. */
const COL = 4;

/** How many cells the step empties out of `COL`, and so how far its gems fall. */
const CLEARED = 3;

/**
 * Three rubies that make a vertical run at the foot of column 4 once the middle
 * one trades in from next door — `settling/r9-gems-fall`'s arrangement exactly.
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

/**
 * Frames that carry the recording to just short of the end of the step the
 * reading was taken in, so the replay holds the travel the figures describe
 * rather than stopping on the frame the step resolved.
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

afterEach(() => {
  h.dispose();
});

it("reports each fallen gem's drop as its new row less its old row", async () => {
  const posed = quietRowsWith(SCENARIO);
  const resolved = swapped(posed, A, B);
  // The arrangement is proved rather than assumed: the posed board carries no
  // run of its own, and the swap's run seeds exactly the three cells at the foot
  // of column 4 — which is what puts the whole gap below every survivor.
  assertLength(maximalRuns(posed), 0, "maximal runs on the posed board");
  assertDeepEqual(
    clearSetFromRuns(resolved),
    CLEAR_SET,
    "the clear set the swap produces",
  );

  // R9 as `board.ts` restates it, over the board the swap produced and the cells
  // the removal emptied. It is the oracle for what each cell owes, so no figure
  // below is written down twice.
  const settlement = settleBoard(resolved, CLEAR_SET);

  /**
   * Each survivor of the column: where it was posed, where R9 leaves it, the
   * kind it carries, and the `fell` R9 fixes for the cell it lands in.
   *
   * Five gems, five kinds, no repeat — which is what lets the reading say WHICH
   * gem arrived as well as how far it says it came.
   */
  const survivors = Array.from({ length: GRID_ROWS - CLEARED }, (_, row) => ({
    posed: { col: COL, row },
    landed: { col: COL, row: row + CLEARED },
    kind: parseToken(tokenAt(posed, COL, row)).kind,
    fell: fellAt(settlement, COL, row + CLEARED),
  }));

  // The fixture's last premise: no two survivors share a kind, so following one
  // to its new cell cannot land on another by accident, and each expectation is
  // the exact figure R9 fixes rather than a floor.
  assertLength(
    [...new Set(survivors.map((survivor) => survivor.kind))],
    GRID_ROWS - CLEARED,
    "distinct kinds among the column's survivors",
  );
  for (const survivor of survivors) {
    assertEqual(
      showFell(survivor.fell),
      String(CLEARED),
      `the drop R9 fixes for the gem posed at ` +
        `(${survivor.posed.col},${survivor.posed.row})`,
    );
  }

  loadBoard(h, posed);
  const settled = await captureReplay(h, "fell", async () => {
    const first = await swapAndStep(h, A, B);
    await h.advance(restOfStep(first));
    return first;
  });
  assertEqual(settled.chainStep, 1, "the chain step the swap opened");

  for (const survivor of survivors) {
    const where =
      `(${survivor.posed.col},${survivor.posed.row}) -> ` +
      `(${survivor.landed.col},${survivor.landed.row})`;
    const arrived = cellAt(settled, survivor.landed.col, survivor.landed.row);
    // Kind first, so a build that moved the wrong gem is reported as having
    // moved the wrong gem rather than as having reported the wrong distance.
    assertEqual(arrived.kind, survivor.kind, `the kind that arrived, ${where}`);
    assertFell(arrived.fell, survivor.fell, `the rows it traveled, ${where}`);
  }
});
