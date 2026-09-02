// editor/removing-the-selected-part-clears-the-selection — whichever of the three
// routes takes the selected part off the field, the selection goes with it.
//
// THE RULE. "An edit, undo, or redo that removes the selected part clears the
// selection, and one that removes the cursor's arm clears the cursor"
// (`specs/editor.md`, Undo and redo). Three routes are named and all three are
// posed; `specs/instrumentation.md` reports the selection as `editor.selected`,
// `null` when nothing is selected.
//
// THE THREE ROUTES, each reaching a removal a different way:
//
//   1. THE EDIT. `part-delete` on the selected part — "`part-delete` removes any
//      part" (`specs/editor.md`, Selection on the field), bound to `KeyX` under
//      field focus (`specs/controls.md`).
//   2. THE REDO. The same deletion undone — which puts the part back but leaves
//      the selection where the rule left it — then selected again through
//      `setSelected`, then `redo`, which "re-applies the latest undone edit" and
//      so removes it a second time.
//   3. THE UNDO. A drag out of the tray, which "places it and selects it", then
//      `undo`, which "restores the machine from the latest entry" — a machine
//      without the part just placed.
//
// EACH ROUTE IS READ TWICE: the selection names the part just before the removal,
// and reads `null` just after. Without the first reading a build that never
// selects anything would pass; without the second the item is not decided.
//
// THE CONFIGURATION. One arm at `(0, 0)` and one wheel at `(3, 0)`, far enough
// apart that neither reaches the other. The wheel is the part the removals never
// touch, so the field is never empty and "clears the selection" cannot be
// confused with "there is nothing to select". The arm and the wheel are of
// different kinds, so the arm restored by the undo in route 2 is found by its kind
// rather than by an id nothing in `specs/` requires a restored part to keep.
//
// THE VERDICT. `editor.selected` reads `null` after the delete, after the redo,
// and after the undo.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the selection on the delete, on the redo, and on the undo", async () => {
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

    // Route 1: the edit.
    await h.debug.setFocus("field");
    await h.debug.setSelected(solePartOfKind(posed, "arm")?.id ?? -1);
    const beforeDelete = await h.snapshot();
    await pressAction(h, "part-delete");
    const deleted = await h.snapshot();

    // Route 2: the redo of that same deletion.
    await pressAction(h, "undo");
    const restored = await h.snapshot();
    await h.debug.setSelected(solePartOfKind(restored, "arm")?.id ?? -1);
    const beforeRedo = await h.snapshot();
    await pressAction(h, "redo");
    const redone = await h.snapshot();

    // Route 3: the undo of a placement.
    await dragFromTray(h, ARM_SLOT, WEST);
    const beforeUndo = await h.snapshot();
    await pressAction(h, "undo");
    const undone = await h.snapshot();

    return {
      posed,
      beforeDelete,
      deleted,
      restored,
      beforeRedo,
      redone,
      beforeUndo,
      undone,
    };
  });

  assertLength(
    readings.posed.editor.parts,
    2,
    "the machine stands with the arm and the wheel the scenario placed",
  );

  assertNotNull(
    readings.beforeDelete.editor.selected,
    "the arm is selected before the part-delete press",
  );
  assertNull(
    readings.deleted.editor.selected,
    "an edit that removes the selected part clears the selection",
  );

  assertNotNull(
    solePartOfKind(readings.restored, "arm"),
    "the undo put the arm back, so there is something for the redo to remove",
  );
  assertNotNull(
    readings.beforeRedo.editor.selected,
    "the restored arm is selected before the redo press",
  );
  assertNull(
    readings.redone.editor.selected,
    "a redo that removes the selected part clears the selection",
  );

  assertEqual(
    readings.beforeUndo.editor.selected,
    solePartOfKind(readings.beforeUndo, "arm")?.id,
    "the tray drag placed the arm and selected it",
  );
  assertNull(
    readings.undone.editor.selected,
    "an undo that removes the selected part clears the selection",
  );
  assertLength(
    readings.undone.editor.parts,
    1,
    "and the wheel is still on the field, so the selection was cleared rather than emptied out",
  );
});
