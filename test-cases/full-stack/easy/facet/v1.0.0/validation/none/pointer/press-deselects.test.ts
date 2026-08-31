// Facet — pointer/press-deselects: a press on the cell that is already selected
// clears the selection.
//
// The second row of specs/controls.md's press table: "The selected cell — Clears
// the selection." The rows are "evaluated in order, and the first row that
// matches is the one that applies", so this row is reached only with a selection
// standing, and it is what keeps a player able to change their mind: the same
// gesture that chose a gem lets it go again.
//
// WHAT MAKES THIS A REAL QUESTION rather than a restatement of the first row. A
// build that answered every press by selecting the cell it targeted would leave
// the selection sitting on that cell here instead of clearing it, and a build
// that read the rows out of order — asking whether the target is a NEIGHBOR of
// the selection before asking whether it IS the selection — would still clear it
// but would also have requested a swap of a cell with itself. So both readings
// are taken: the selection is gone, and the board is untouched.
//
// The selection is posed with `setSelection`, which specs/instrumentation.md says
// makes a cell the selected one and requests no swap, so the press below meets
// exactly the state the table's second row describes and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  assertBoardEquals,
  cellCenter,
  quietRowsWithEscape,
  type CellRef,
} from "../board";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

/** The cell the selection stands on and the press then lands on. */
const CELL: CellRef = { col: 3, row: 3 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the selection when the press lands on the selected cell", async () => {
  const posed = quietRowsWithEscape([]);
  await loadBoard(h, posed);

  await h.debug.setSelection(CELL.col, CELL.row);
  assertDeepEqual(
    (await h.snapshot()).selection,
    CELL,
    "the selection the press is about to land on",
  );

  const center = cellCenter(CELL.col, CELL.row);
  await h.debug.pointerDown(center.x, center.y);
  const after = await h.snapshot();
  await h.debug.pointerUp();

  // The frame the still is of, taken before the assertions so a failure still
  // leaves the picture that shows what the build did instead.
  await h.advance(1);
  await captureStill(h, "deselect");

  assertNull(after.selection, "the selection a press on it cleared");
  // Letting a gem go is not a move: the board is exactly as it was posed, and
  // nothing is resolving, so no swap of the cell with itself was requested.
  assertEqual(after.phase, "idle", "the phase a deselecting press leaves");
  assertBoardEquals(
    await h.board(),
    posed,
    "the board a deselecting press leaves",
  );
});
