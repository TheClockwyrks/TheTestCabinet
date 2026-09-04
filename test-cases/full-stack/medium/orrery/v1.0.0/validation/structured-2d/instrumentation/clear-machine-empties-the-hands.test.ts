// instrumentation/clear-machine-empties-the-hands — `clearMachine` empties both
// histories and clears the hands.
//
// THE RULE. "`clearMachine()` — Removes every placed part, empties both
// histories, and clears the selection, the cursor, and any live drag"
// (`specs/instrumentation.md`, The machine). This item is everything after the
// first clause. The snapshot carries the four as `editor.undoDepth`,
// `editor.redoDepth`, `editor.selected`, `editor.cursor` and `editor.drag`, whose
// resting values are `0`, `0`, `null`, `null` and `null`.
//
// WHY AN EMPTY HISTORY MATTERS. `specs/editor.md`: "The `undo` action restores
// the machine from the latest entry"; with the history emptied there is no entry
// to restore from, and "Both ... do nothing with empty history" — so no undo
// reaches back past the clear. That is read here rather than assumed.
//
// WHERE THE HANDS COME FROM. Both histories move "under edits made through the
// pointer and the keys alone", so the machine is built by dragging out of the
// tray, and one `undo` puts an entry on the redo side as well. The selection and
// the cursor are then posed through their own operations, and a live drag is
// begun with a press on a part — "a press on a part selects it at once and begins
// a move" — and left un-released, so `clearMachine` is called with a drag genuinely
// in flight. All five are read back before the clear, so what is being emptied is
// there to empty.
//
// THE VERDICT. Both depths are `0`, `selected`, `cursor` and `drag` are `null`,
// and an `undo` pressed afterwards restores nothing: the machine is still empty
// and the history still has no depth.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { at, hexCenter } from "../field";
import {
  captureStill,
  createHarness,
  dragFromTray,
  openChallenge,
  openTitle,
  partIds,
  pressAction,
  pressAt,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties both histories and clears the selection, the cursor and the drag", async () => {
  await openTitle(h);
  await openChallenge(h, "extras", 0);

  await dragFromTray(h, 0, at(0, 0));
  await dragFromTray(h, 0, at(2, 0));
  await pressAction(h, "undo");
  const kept = (await partIds(h))[0] ?? -1;
  await h.debug.setSelected(kept);
  await h.debug.setCursor(kept, 3);
  await pressAt(h, hexCenter(at(0, 0)));

  const before = await h.snapshot();
  assertGreaterThan(
    before.editor.undoDepth,
    0,
    "the drags left an undo history to empty",
  );
  assertGreaterThan(
    before.editor.redoDepth,
    0,
    "the undo left a redo history to empty",
  );
  assertNotNull(before.editor.selected, "a part is selected to be deselected");
  assertNotNull(before.editor.cursor, "a cursor stands to be cleared");
  assertNotNull(before.editor.drag, "and a drag is live to be dropped");

  await h.debug.clearMachine();
  await h.advance(1);
  await captureStill(h, "emptied");

  const cleared = await h.snapshot();
  assertEqual(cleared.editor.undoDepth, 0, "the undo history is empty");
  assertEqual(cleared.editor.redoDepth, 0, "the redo history is empty");
  assertNull(cleared.editor.selected, "nothing is selected");
  assertNull(cleared.editor.cursor, "the tape cursor is cleared");
  assertNull(cleared.editor.drag, "and the live drag is gone");

  const undone = await pressAction(h, "undo");
  assertDeepEqual(
    undone.editor.parts,
    [],
    "undo with an empty history does nothing, so no undo reaches back past the clear",
  );
  assertEqual(
    undone.editor.undoDepth,
    0,
    "and the history is still empty afterwards",
  );
});
