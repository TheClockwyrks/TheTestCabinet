// editor/removing-the-cursors-arm-clears-the-cursor — whichever of the three
// routes takes the cursor's arm off the field, the cursor goes with it.
//
// THE RULE. "An edit, undo, or redo that removes the selected part clears the
// selection, and ONE THAT REMOVES THE CURSOR'S ARM CLEARS THE CURSOR"
// (`specs/editor.md`, Undo and redo). Three routes are named and all three are
// posed; `specs/instrumentation.md` reports the cursor as `editor.cursor`, `null`
// when it points at nothing. The rule has a counterpart in the panel itself:
// "deleting an arm or wheel discards its tape and its row" (`specs/editor.md`,
// Dragging), so a cursor that survived would be pointing at a row that is gone.
//
// THE THREE ROUTES, each reaching a removal a different way:
//
//   1. THE EDIT. `part-delete` on the arm the cursor points at — "`part-delete`
//      removes any part" (Selection on the field), bound to `KeyX` under field
//      focus (`specs/controls.md`).
//   2. THE REDO. The same deletion undone, the cursor pointed at the restored arm
//      through `setCursor`, then `redo`, which "re-applies the latest undone edit"
//      and so removes it a second time.
//   3. THE UNDO. A drag out of the tray, the cursor pointed at the new arm, then
//      `undo`, which "restores the machine from the latest entry" — a machine
//      without the part just placed.
//
// THE CURSOR IS POSED THROUGH `setCursor` rather than left to the press that
// selects, because "Selecting an arm or wheel also points the tape cursor at its
// row, cell `0`" is a rule of its own and a separate item; this one decides only
// what a REMOVAL does to a cursor that is standing on the removed arm.
// `specs/instrumentation.md` lists `setCursor` among the operations that push no
// undo entry.
//
// EACH ROUTE IS READ TWICE: the cursor names the arm just before the removal, and
// reads `null` just after. Without the first reading a build whose cursor is never
// set would pass.
//
// THE RESTORED ARM IS THE ARM. "A part an entry restores is the part it was, its
// identity included, so a selection or a cursor that named it names it still, and
// only a part the restored machine does not hold counts as removed"
// (`specs/editor.md`, Undo and redo). Route 2 therefore reads the undo on the id:
// the arm handed back carries the id the deleted arm had, and the cursor is
// pointed back at that same id for the redo to take away a second time.
//
// THE CONFIGURATION. One arm at `(0, 0)` and one wheel at `(3, 0)` — "a wheel
// carries a tape like an arm" (`specs/parts.md`), so the panel keeps a row after
// every removal and a cleared cursor cannot be confused with a panel that has no
// rows left.
//
// THE VERDICT. `editor.cursor` reads `null` after the delete, after the redo, and
// after the undo.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNull,
} from "../assert";
import { armPart, derivedTray, solution } from "../formats";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureReplay,
  createHarness,
  dragFromTray,
  loadMachine,
  openChallengeDocument,
  pressAction,
  solePartOfKind,
  type Harness,
} from "../harness";

/** The tray entry an arm is taken from (`specs/editor.md`, The tray). */
const ARM_SLOT = derivedTray(BARE).findIndex((entry) => entry.kind === "arm");

/** The column the cursor is pointed at: cell `0` of the arm's row. */
const COLUMN = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the cursor on the delete, on the redo, and on the undo", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
      armPart("wheel", EAST.q, EAST.r, 0, 1, []),
    ]),
  );

  const readings = await captureReplay(h, "cleared", async () => {
    const posed = await h.snapshot();
    const arm = solePartOfKind(posed, "arm")?.id ?? -1;

    // Route 1: the edit.
    await h.debug.setFocus("field");
    await h.debug.setSelected(arm);
    await h.debug.setCursor(arm, COLUMN);
    const beforeDelete = await h.snapshot();
    await pressAction(h, "part-delete");
    const deleted = await h.snapshot();

    // Route 2: the redo of that same deletion, on the arm the undo hands back.
    await pressAction(h, "undo");
    const restored = await h.snapshot();
    const back = solePartOfKind(restored, "arm")?.id ?? -1;
    await h.debug.setCursor(arm, COLUMN);
    const beforeRedo = await h.snapshot();
    await pressAction(h, "redo");
    const redone = await h.snapshot();

    // Route 3: the undo of a placement.
    await dragFromTray(h, ARM_SLOT, WEST);
    const placed = solePartOfKind(await h.snapshot(), "arm")?.id ?? -1;
    await h.debug.setCursor(placed, COLUMN);
    const beforeUndo = await h.snapshot();
    await pressAction(h, "undo");
    const undone = await h.snapshot();

    return {
      posed,
      arm,
      beforeDelete,
      deleted,
      restored,
      back,
      beforeRedo,
      redone,
      placed,
      beforeUndo,
      undone,
    };
  });

  assertLength(
    readings.posed.editor.parts,
    2,
    "the machine stands with the arm and the wheel the scenario placed",
  );

  assertDeepEqual(
    readings.beforeDelete.editor.cursor,
    { part: readings.arm, col: COLUMN },
    "the cursor points at the arm's row before the part-delete press",
  );
  assertNull(
    readings.deleted.editor.cursor,
    "an edit that removes the cursor's arm clears the cursor",
  );

  assertEqual(
    readings.back,
    readings.arm,
    "the undo put the arm back as the part it was, identity included",
  );
  assertDeepEqual(
    readings.beforeRedo.editor.cursor,
    { part: readings.arm, col: COLUMN },
    "so the cursor points at that same arm's row again before the redo press",
  );
  assertNull(
    readings.redone.editor.cursor,
    "a redo that removes the cursor's arm clears the cursor",
  );

  assertDeepEqual(
    readings.beforeUndo.editor.cursor,
    { part: readings.placed, col: COLUMN },
    "the cursor points at the arm the tray drag placed, before the undo press",
  );
  assertNull(
    readings.undone.editor.cursor,
    "an undo that removes the cursor's arm clears the cursor",
  );
  assertLength(
    readings.undone.editor.parts,
    1,
    "and the wheel is still on the field, so the panel still has a row to point at",
  );
});
