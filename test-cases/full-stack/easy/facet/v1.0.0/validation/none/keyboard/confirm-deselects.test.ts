// Facet — keyboard/confirm-deselects: `confirm` fired while the cursor sits on
// the cell that is already selected clears the selection.
//
// WHY THIS IS A POINT OF ITS OWN. specs/controls.md gives the keyboard no table
// of board behavior of its own. It says "`confirm` acts on the cursor's cell
// exactly as a press on that cell does. The four rows under Selecting and
// swapping decide it, read against the cursor's cell in place of a targeted
// one." The second of those four rows — "The selected cell | Clears the
// selection" — is therefore a keyboard behavior as much as a pointer one, and
// it is the row a build is most likely to lose: an implementation that treats
// `confirm` as "select the cursor's cell" alone re-selects the cell a player
// meant to let go of and never gives them a way to drop a selection from the
// keyboard, while every other row of the table still reads correctly.
//
// WHAT IT DELIBERATELY DOES NOT DECIDE. That a POINTER press on the selected
// cell clears it belongs to the pointer items, and that `confirm` on an
// unselected cell selects it belongs to `confirm-selects`. So the selection here
// is arranged through the debug surface — specs/instrumentation.md fixes
// `setSelection` as making a cell selected with "the cursor, the board, and the
// phase stand where they were" — rather than by pressing `confirm` twice. The
// only build behavior this file reads is the one row it is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { assertBoardEquals, quietRowsWithEscape } from "../board";
import { BINDINGS } from "../constants";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

/** The cell the scenario selects, and the cell the cursor is put on. */
const CELL = { col: 3, row: 3 };

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the selection when confirm fires on the selected cell", async () => {
  // A run-free filler carrying one spare legal swap: nothing on it can resolve
  // under the frame the key press runs, so the board read back afterwards is
  // the board that was posed, and the round cannot end underneath the check.
  const rows = quietRowsWithEscape([]);
  await loadBoard(h, rows);
  await h.debug.setSelection(CELL.col, CELL.row);
  await h.debug.setCursor(CELL.col, CELL.row);

  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "the screen the scenario is posed on");
  assertDeepEqual(before.selection, CELL, "the arranged selection");
  assertDeepEqual(before.cursor, CELL, "the arranged cursor");

  // `Enter` is the first key specs/controls.md binds to `confirm`, and that
  // binding table is fixed for a build of every engine — so this is the same
  // gesture under all three. `tapAction` delivers it as one press the frame
  // reads as an edge.
  await h.tapAction("confirm");

  // A tap runs the frame that reads the press, so what stands on the canvas
  // now is the board drawn with nothing selected. Kept before the assertions,
  // so a build that held on to the selection still leaves the picture that
  // shows what it drew instead.
  await captureStill(h, "deselect");

  const after = await h.snapshot();
  assertNull(
    after.selection,
    "the selection after confirm on the cell it already held",
  );

  // The row clears the selection and does nothing else. No swap was requested,
  // so the board still rests exactly as it was posed, the phase is still idle,
  // and `confirm` moved no cursor.
  assertBoardEquals(
    await h.board(),
    rows,
    "the board after confirm on the selected cell",
  );
  assertEqual(
    after.phase,
    "idle",
    "the phase after confirm cleared a selection",
  );
  assertDeepEqual(after.cursor, CELL, "the cursor after confirm");

  // "Each key listed for an action fires that action on its own", so the
  // alternate binding reaches the same row. Re-arrange the selection and press
  // it rather than `Enter`.
  const alternate = BINDINGS.confirm[1];
  await h.debug.setSelection(CELL.col, CELL.row);
  assertDeepEqual(
    (await h.snapshot()).selection,
    CELL,
    "the re-arranged selection",
  );
  await h.tap(alternate);
  assertNull(
    (await h.snapshot()).selection,
    `the selection after ${alternate}`,
  );
});
