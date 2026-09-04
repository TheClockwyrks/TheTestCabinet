// editor/part-delete-removes-the-selected-part — one `part-delete` press takes the
// selected part off the machine and leaves nothing selected.
//
// THE RULE. "The field-focus actions of `specs/controls.md` act on the selected
// part: … and `part-delete` REMOVES ANY PART" (`specs/editor.md`, Selection on the
// field). `specs/controls.md` binds it: "`part-delete` | `KeyX` | Removes the
// selected part." What is left behind is fixed by the undo section of
// `specs/editor.md`: "An edit, undo, or redo that REMOVES THE SELECTED PART CLEARS
// THE SELECTION." The machine the removal is read out of is
// `specs/instrumentation.md`'s `editor.parts`, "placement order; the tape panel's
// row order", with `selected: <number | null>` beside it.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and TWO
// arms, on `(-3, 0)` and `(3, 0)` — six hexes apart, so neither reaches the other
// and neither shares an anchor. The WEST arm is selected, through the surface's
// `setSelected`; the focus is posed on the field, where the verb is routed. The
// second arm is there so the press is read as removing THAT PART rather than as
// emptying the machine: "An edit changes the edited part alone."
//
// THE VERDICT. The selected arm is gone from `editor.parts`, `editor.selected` is
// `null`, and the arm that was not selected is still there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { BARE, EAST, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  pressAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the selected arm and clears the selection, leaving the other arm alone", async () => {
  await openChallengeDocument(h, BARE);
  const west = await placePart(h, "arm", WEST);
  const east = await placePart(h, "arm", EAST);
  await h.debug.setSelected(west);
  await h.debug.setFocus("field");

  const before = await h.snapshot();

  await pressAction(h, "part-delete");
  await captureStill(h, "deleted");

  assertNotNull(partById(before, west), "the west arm is on the field");
  assertEqual(before.editor.parts.length, 2, "and two arms stand on it");
  assertEqual(before.editor.selected, west, "with the west arm selected");

  const after = await h.snapshot();
  assertNull(
    partById(after, west),
    "one part-delete press removes the selected part from editor.parts",
  );
  assertNull(
    after.editor.selected,
    "an edit that removes the selected part clears the selection",
  );
  assertNotNull(
    partById(after, east),
    "the arm that was not selected is still on the field: an edit changes the edited part alone",
  );
  assertEqual(
    after.editor.parts.length,
    1,
    "so exactly one arm is left standing",
  );
});
