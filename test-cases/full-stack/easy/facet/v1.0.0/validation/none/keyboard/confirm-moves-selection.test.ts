// Facet — keyboard/confirm-moves-selection: `confirm` fired while the cursor
// sits on a cell that is neither the selection nor a neighbor of it moves the
// selection to the cursor's cell.
//
// THE LAST ROW OF THE TABLE. specs/controls.md reads the keyboard through the
// pointer's own four rows — "`confirm` acts on the cursor's cell exactly as a
// press on that cell does" — and the fourth is "Any other cell | Moves the
// selection to that cell." The rows are "evaluated in order, and the first row
// that matches is the one that applies", so this is the row that catches
// everything the three above it did not: a distant cell, and a DIAGONAL
// neighbor, which R1 does not count as adjacent.
//
// WHAT A BUILD GETS WRONG HERE. The plausible failure is not a crash; it is a
// build that treats a `confirm` matching none of the first three rows as a
// no-op, or as a swap request the move rules then refuse. Either leaves a player
// unable to change their mind about which gem they picked without pressing
// `confirm` on it twice. So this check reads what the row promises — where the
// selection ENDS UP — and reads it against a board that cannot resolve, so a
// selection that moved is the only thing that could have changed.
//
// The selection is arranged through the debug surface rather than by pressing
// `confirm` on the first cell, because that press is `confirm-selects`'s point,
// not this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  areAdjacent,
  assertBoardEquals,
  quietRowsWithEscape,
  type CellRef,
} from "../board";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

/** The cell the scenario starts with selected. */
const SELECTED: CellRef = { col: 1, row: 1 };

/** A distant cell: neither the selection nor orthogonally adjacent to it. */
const FAR: CellRef = { col: 5, row: 5 };

/**
 * A DIAGONAL neighbor of the selection.
 *
 * R1 counts two cells adjacent only when they "differ by `1` in column and `0`
 * in row, or by `0` in column and `1` in row", so a diagonal is "any other
 * cell" and falls to the fourth row like the far one does. It is the reading a
 * build that measured adjacency with a distance rather than with R1 gets wrong.
 */
const DIAGONAL: CellRef = { col: 2, row: 2 };

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves the selection when confirm fires on any other cell", async () => {
  // Neither target is adjacent under R1, which is what puts both on the fourth
  // row of the table rather than the third.
  assertEqual(
    areAdjacent(SELECTED, FAR),
    false,
    "R1 adjacency of the selection and the far cell",
  );
  assertEqual(
    areAdjacent(SELECTED, DIAGONAL),
    false,
    "R1 adjacency of the selection and the diagonal cell",
  );

  // A run-free filler carrying one spare legal swap: no chain can start under
  // the frame the key press runs, so the board read back is the board posed.
  const rows = quietRowsWithEscape([]);
  await loadBoard(h, rows);
  await h.debug.setSelection(SELECTED.col, SELECTED.row);
  await h.debug.setCursor(FAR.col, FAR.row);

  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the scenario is posed on");
  assertDeepEqual(before.selection, SELECTED, "the arranged selection");
  assertDeepEqual(before.cursor, FAR, "the arranged cursor");

  // `Enter` is the first key specs/controls.md binds to `confirm`, and the
  // binding table is fixed for a build of every engine.
  await h.tapAction("confirm");

  // A tap runs the frame that reads the press, so the canvas holds the board
  // drawn with the selection standing on the far cell rather than on the one
  // it started at — which is the whole of what the fourth row promises.
  await captureStill(h, "select");

  const after = await h.snapshot();
  assertDeepEqual(after.selection, FAR, "the selection after confirm moved it");
  // The row moves the selection and does nothing else: no swap was requested,
  // so the board rests where it was posed and the phase is still idle.
  assertBoardEquals(
    await h.board(),
    rows,
    "the board after the selection moved",
  );
  assertEqual(after.phase, "idle", "the phase after confirm moved a selection");

  // A diagonal neighbor is "any other cell" too, and lands on the same row. The
  // selection goes back where it started so the diagonal is measured against it.
  await h.debug.setSelection(SELECTED.col, SELECTED.row);
  await h.debug.setCursor(DIAGONAL.col, DIAGONAL.row);
  await h.tapAction("confirm");
  assertDeepEqual(
    (await h.snapshot()).selection,
    DIAGONAL,
    "the selection after confirm on a diagonal neighbor",
  );

  // "Each key listed for an action fires that action on its own", so the
  // alternate binding moves the selection as well.
  const alternate = BINDINGS.confirm[1];
  await h.debug.setSelection(SELECTED.col, SELECTED.row);
  await h.debug.setCursor(FAR.col, FAR.row);
  await h.tap(alternate);
  assertDeepEqual(
    (await h.snapshot()).selection,
    FAR,
    `the selection after ${alternate}`,
  );
});
