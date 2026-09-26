// editor/selecting-keeps-the-focus-on-the-field — selecting an arm leaves the focus
// on the field, even though the same selection points the tape cursor.
//
// THE RULE. "Selecting an arm or wheel also points the tape cursor at its row,
// cell `0`, LEAVING THE FOCUS ON THE FIELD" (`specs/editor.md`, Selection on the
// field). `specs/controls.md` says the same thing from the focus's own side: "A
// press inside the tape panel's extent … sets focus to `tape`; a press anywhere
// else on the editor screen sets it to `field`" — and a press that selects a part
// is a press on the FIELD.
//
// WHY IT MATTERS, and what a build gets wrong if it moves the focus with the
// cursor: the focus "routes the editing keys", and "Two focus-routed actions share
// a physical key: `part-grow` and `ins-extend` on `KeyW`". A selection that left
// the focus on the tape would turn every field verb into a tape verb.
//
// THE CONFIGURATION. `BARE` opened in the editor, its machine cleared, and ONE arm
// anchored on `(0, 0)` — the only part on the field, so the press targets it and
// nothing else. The focus is put on the TAPE first, through the surface's
// `setFocus`, which "Sets the focus" and does nothing else
// (`specs/instrumentation.md`). That is what makes the reading afterwards mean
// something: `field` after the press cannot be a focus the press never touched.
// The press is released on the hex it began on, which "commits no move".
//
// THE VERDICT. The focus really was `tape` before the press, the press really did
// select the arm, and the focus is `field` afterwards.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { hexCenter } from "../field";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  placePart,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the focus on the field when a press selects an arm", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);

  await h.debug.setFocus("tape");
  const before = (await h.snapshot()).editor.focus;

  await pressAt(h, hexCenter(ORIGIN));
  await h.advance(1);
  await captureStill(h, "focus");
  const editor = (await h.snapshot()).editor;
  await releasePointer(h);

  assertEqual(
    before,
    "tape",
    "the focus is on the tape before the press, so a field focus after it is the press's doing",
  );
  assertEqual(
    editor.selected,
    arm,
    "the press really did select the arm, so the focus below was read after a selection",
  );
  assertEqual(
    editor.focus,
    "field",
    "selecting an arm leaves the focus on the field, so KeyW still reaches part-grow rather than ins-extend",
  );
});
