// instrumentation/set-selected-null-clears — the operation that clears the
// selection.
//
// THE RULE. "`setSelected(part)` | Selects that part. `null` clears the selection"
// (`specs/instrumentation.md`, The editor's hands). The snapshot carries the hand
// as `editor.selected`, whose resting value is `null`
// (`specs/instrumentation.md`, Snapshot shape).
//
// SO THE CHECK READS THE HAND AND THEN THE CONSEQUENCE. With nothing selected the
// field-focus verbs of `specs/controls.md` have nothing to act on — they act "on
// the selected part" (`specs/editor.md`), and `part-delete` "Removes the selected
// part" — so the arm that WAS selected keeps its rotation and keeps its place on
// the machine after both verbs have been pressed. The still is the evidence for
// nothing being drawn as selected; the verdict is the cleared hand and the two
// verbs that landed on nothing.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, an empty machine, and one
// arm — selected first, so the clearing has something to clear — with the focus
// posed to `field`, which is the focus the field verbs are read under. No run is
// started: selection is an editing hand.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  pressAction,
  type Harness,
} from "../harness";
import { BARE, ORIGIN } from "../fixtures";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the selection null, so a part verb acts on nothing", async () => {
  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();
  const arm = await placePart(h, "arm", ORIGIN, 0);
  await h.debug.setFocus("field");

  await h.debug.setSelected(arm);
  const held = await h.snapshot();
  assertEqual(
    held.editor.selected,
    arm,
    "the arm is the selection before it is cleared",
  );

  await h.debug.setSelected(null);
  const cleared = await h.snapshot();
  assertNull(cleared.editor.selected, "setSelected(null) clears the selection");

  await pressAction(h, "part-cw");
  await pressAction(h, "part-delete");
  await captureStill(h, "cleared");

  const after = await h.snapshot();
  assertNull(
    after.editor.selected,
    "the selection is still clear after two verbs that found nothing to act on",
  );
  assertLength(
    after.editor.parts,
    1,
    "part-delete removes the selected part, and nothing was selected",
  );
  const standing = partById(after, arm);
  assertNotNull(standing, "the arm the verbs did not act on is still placed");
  assertEqual(
    standing?.rotation,
    0,
    "part-cw turns the selected part, and nothing was selected",
  );
});
