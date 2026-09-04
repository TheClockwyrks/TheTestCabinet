// editor/resizing-a-part-pushes-one-entry — a `part-grow` press that lengthens the
// selected arm is one edit, and one undo shortens it back.
//
// THE RULE. "Every committed edit to the machine pushes one entry onto the undo
// history: placing, moving, or deleting a part, ending a lay that changed a track,
// rotating or resizing a part, and each write to a tape... The entry holds the
// machine as it stood before the edit: the parts with their poses, paths, and
// tapes", and "The `undo` action restores the machine from the latest entry"
// (`specs/editor.md`, Undo and redo). The press is `specs/controls.md`'s
// `part-grow` on `KeyW`, routed by field focus — "the game reads the ones the
// current focus names" — and `specs/editor.md` says what it does: "`part-grow` and
// `part-shrink` change an arm's length within the bounds `specs/parts.md` fixes".
//
// THE CONFIGURATION. One arm at `(0, 0)` at rest length `2`, alone on the field.
// "Length is a whole number from `ARM_MIN_LEN` (`1`) to `ARM_MAX_LEN` (`3`)"
// (`specs/parts.md`), so `2` has room above it and the press is inside the bounds;
// and neither `2` nor `3` is the length a fresh part opens at, so a build
// reporting a fixed length rather than the arm's own is caught by either reading.
// A length change moves no anchor, and rule 1 asks only that "an arm or wheel's
// anchor" be on the field, so this growth cannot be refused as illegal — which is
// a separate item.
//
// THE FOCUS IS SET BEFORE THE PRESS, because `KeyW` carries `part-grow` and
// `ins-extend` both, and "each is registered on its own, and the game reads the
// ones the current focus names" (`specs/controls.md`).
//
// THE VERDICT. The press lengthens the arm by one, `editor.undoDepth` rises by
// exactly `1`, and one undo restores the length it stood at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { ARM_MAX_LEN, RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  pressAction,
  solePartOfKind,
  type Harness,
} from "../harness";

/** The arm's rest length before the press, and the length one step above it. */
const REST_LENGTH = 2;
const GROWN = REST_LENGTH + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the undo depth by one, and one undo restores the previous length", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, REST_LENGTH, [])]),
  );

  const readings = await captureReplay(h, "undone", async () => {
    await h.advance(RECORDING_RUN_UP);
    const posed = await h.snapshot();
    await h.debug.setFocus("field");
    await h.debug.setSelected(solePartOfKind(posed, "arm")?.id ?? -1);

    await pressAction(h, "part-grow");
    const grown = await h.snapshot();

    await pressAction(h, "undo");
    const undone = await h.snapshot();

    await h.advance(RECORDING_SETTLE);
    return { posed, grown, undone };
  });

  const { posed, grown, undone } = readings;
  assertEqual(
    solePartOfKind(posed, "arm")?.length,
    REST_LENGTH,
    "the arm stands at the rest length it was placed at, one below ARM_MAX_LEN",
  );
  assertEqual(
    GROWN,
    ARM_MAX_LEN,
    "the length the press produces is inside the bounds specs/parts.md fixes",
  );

  assertNotNull(
    solePartOfKind(grown, "arm"),
    "the arm is still on the field after the part-grow press",
  );
  assertEqual(
    solePartOfKind(grown, "arm")?.length,
    GROWN,
    "part-grow lengthens the selected arm by one within the bounds",
  );
  assertEqual(
    grown.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "resizing a part pushes exactly one entry onto the undo history",
  );

  assertNotNull(
    solePartOfKind(undone, "arm"),
    "the arm is still on the field after the undo",
  );
  assertEqual(
    solePartOfKind(undone, "arm")?.length,
    REST_LENGTH,
    "one undo restores the length the arm stood at before the press",
  );
  assertEqual(
    undone.editor.undoDepth,
    posed.editor.undoDepth,
    "and the one entry the resize pushed is the one the undo took",
  );
});
