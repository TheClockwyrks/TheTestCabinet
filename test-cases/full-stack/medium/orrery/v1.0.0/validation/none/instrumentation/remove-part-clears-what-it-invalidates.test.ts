// instrumentation/remove-part-clears-what-it-invalidates — a removal clears the
// selection or the cursor it invalidates, and leaves one on another part alone.
//
// THE RULE. "`removePart(part)` | Removes one placed part... and clearing a
// selection or cursor the removal invalidates" (`specs/instrumentation.md`, The
// machine). `specs/editor.md` states the same rule for an edit made by hand: "An
// edit, undo, or redo that removes the selected part clears the selection, and
// one that removes the cursor's arm clears the cursor." The snapshot carries both
// hands: "`selected: <number | null>`" and "`cursor: { part, col } | null`"
// (`specs/instrumentation.md`, Snapshot shape).
//
// THE CONFIGURATION. Three arms, so the selection and the cursor can point at
// DIFFERENT parts and a third can be removed out from under neither: the
// selection on the arm at `(-2, 0)`, the cursor on column `2` of the arm at
// `(2, 0)`, and the arm at `(0, 0)` holding neither. Then three removals in turn —
// the bystander, the selected arm, the cursor's arm — each read before the next.
//
// THE VERDICT. Removing the bystander leaves BOTH hands exactly where they were.
// Removing the selected arm leaves `selected` `null` and the cursor still on its
// own arm's column `2`. Removing the cursor's arm leaves `cursor` `null`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertNull } from "../assert";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partIds,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the selection and the cursor a removal invalidates, and nothing else", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", -2, 0, 0, 1, []),
      armPart("arm", 0, 0, 0, 1, []),
      armPart("arm", 2, 0, 0, 1, []),
    ]),
  );
  const placed = await partIds(h);
  const selected = placed[0] ?? -1;
  const bystander = placed[1] ?? -1;
  const cursored = placed[2] ?? -1;

  await h.debug.setSelected(selected);
  await h.debug.setCursor(cursored, 2);
  const posed = await h.snapshot();

  await h.debug.removePart(bystander);
  const afterBystander = await h.snapshot();

  await h.debug.removePart(selected);
  const afterSelected = await h.snapshot();

  await h.debug.removePart(cursored);
  await h.advance(1);
  await captureStill(h, "cleared");
  const afterCursored = await h.snapshot();

  assertEqual(
    posed.editor.selected,
    selected,
    "the selection is posed on the first arm before anything is removed",
  );
  assertNotNull(
    posed.editor.cursor,
    "the cursor is posed on the third arm's row before anything is removed",
  );
  assertEqual(
    posed.editor.cursor?.part,
    cursored,
    "the cursor is posed on the third arm",
  );
  assertEqual(
    posed.editor.cursor?.col,
    2,
    "the cursor is posed on column 2 of that row",
  );

  assertEqual(
    afterBystander.editor.selected,
    selected,
    "removing a part neither hand points at leaves the selection standing",
  );
  assertEqual(
    afterBystander.editor.cursor?.part,
    cursored,
    "removing a part neither hand points at leaves the cursor standing",
  );
  assertEqual(
    afterBystander.editor.cursor?.col,
    2,
    "removing a part neither hand points at leaves the cursor's column standing",
  );

  assertNull(
    afterSelected.editor.selected,
    "removing the selected part leaves selected null",
  );
  assertEqual(
    afterSelected.editor.cursor?.part,
    cursored,
    "a cursor on another part is not invalidated by that removal",
  );
  assertEqual(
    afterSelected.editor.cursor?.col,
    2,
    "the surviving cursor keeps the column it was posed on",
  );

  assertNull(
    afterCursored.editor.cursor,
    "removing the part the cursor points into leaves cursor null",
  );
});
