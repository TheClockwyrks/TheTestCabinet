// editor/rotating-a-part-pushes-one-entry — a `part-cw` press that turns the
// selected part is one edit, and one undo turns it back.
//
// THE RULE. "Every committed edit to the machine pushes one entry onto the undo
// history: placing, moving, or deleting a part, ending a lay that changed a track,
// rotating or resizing a part, and each write to a tape... The entry holds the
// machine as it stood before the edit: the parts with their poses, paths, and
// tapes", and "The `undo` action restores the machine from the latest entry"
// (`specs/editor.md`, Undo and redo). The press is `specs/controls.md`'s `part-cw`
// on `KeyE`, routed by field focus, and `specs/editor.md` says what it does: "the
// field-focus actions of `specs/controls.md` act on the selected part: `part-cw`
// and `part-ccw` turn an arm, a wheel, or a sigil one rotation step".
//
// THE CONFIGURATION. One arm at `(0, 0)` at rest rotation `4`, alone on the field.
// The rotation is deliberately neither `0` nor the value the press produces, so a
// build that reported a fixed rotation rather than the arm's own would be caught
// by either reading. An arm's placement needs only "an arm or wheel's anchor" on
// the field (`specs/parts.md`, rule 1), and rotation moves no anchor, so the turn
// this check makes cannot be refused as illegal — which is a separate item.
//
// THE DEPTH IS READ AS A RISE, NOT AS A VALUE, because what the history holds when
// the scenario is posed belongs to the operations that posed it, and
// `specs/instrumentation.md` says none of them pushes an entry.
//
// THE VERDICT. The press turns the arm one step clockwise, `editor.undoDepth`
// rises by exactly `1`, and one undo restores the rotation it stood at.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { RECORDING_RUN_UP, RECORDING_SETTLE } from "../constants";
import { turnDirection } from "../field";
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

/** The arm's rest rotation before the press, and the one step clockwise from it. */
const REST_ROTATION = 4;
const TURNED = turnDirection(REST_ROTATION, 1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("raises the undo depth by one, and one undo restores the previous rotation", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", ORIGIN.q, ORIGIN.r, REST_ROTATION, 1, [])]),
  );

  const readings = await captureReplay(h, "undone", async () => {
    await h.advance(RECORDING_RUN_UP);
    const posed = await h.snapshot();
    await h.debug.setFocus("field");
    await h.debug.setSelected(solePartOfKind(posed, "arm")?.id ?? -1);

    await pressAction(h, "part-cw");
    const turned = await h.snapshot();

    await pressAction(h, "undo");
    const undone = await h.snapshot();

    await h.advance(RECORDING_SETTLE);
    return { posed, turned, undone };
  });

  const { posed, turned, undone } = readings;
  assertEqual(
    solePartOfKind(posed, "arm")?.rotation,
    REST_ROTATION,
    "the arm stands at the rest rotation it was placed at",
  );

  assertNotNull(
    solePartOfKind(turned, "arm"),
    "the arm is still on the field after the part-cw press",
  );
  assertEqual(
    solePartOfKind(turned, "arm")?.rotation,
    TURNED,
    "part-cw turns the selected part one rotation step clockwise",
  );
  assertEqual(
    turned.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "rotating a part pushes exactly one entry onto the undo history",
  );

  assertNotNull(
    solePartOfKind(undone, "arm"),
    "the arm is still on the field after the undo",
  );
  assertEqual(
    solePartOfKind(undone, "arm")?.rotation,
    REST_ROTATION,
    "one undo restores the rotation the arm stood at before the press",
  );
  assertEqual(
    undone.editor.undoDepth,
    posed.editor.undoDepth,
    "and the one entry the rotation pushed is the one the undo took",
  );
});
