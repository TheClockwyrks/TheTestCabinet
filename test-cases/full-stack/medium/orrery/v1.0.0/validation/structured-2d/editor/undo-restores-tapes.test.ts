// editor/undo-restores-tapes — an entry holds the parts with their tapes, so one
// undo past a write puts the tape back.
//
// THE RULE. "The entry holds the machine as it stood before the edit: the parts
// with their poses, paths, and TAPES", restored by "The `undo` action restores the
// machine from the latest entry" (`specs/editor.md`, Undo and redo). The tape is
// what the snapshot calls an arm's `tape` (`specs/instrumentation.md`). The edit
// that disturbs one comes from the same file's list of committed edits: "each
// write to a tape".
//
// THE CONFIGURATION IS THE TAPE AND NOTHING ELSE. One arm at `(0, 0)` at rotation
// `4`, length `2`, carrying `[grab, rotate-cw]`, with the cursor on column `0`.
// Nothing else is on the field, so nothing is mounted and the write reaches no
// part it was not aimed at. What an entry does for a part's pose is
// `undo-restores-poses`, and for a track's path `undo-restores-track-paths`; each
// poses its own world and stages its own single edit, so no one of the three can
// only pass while the other two commit.
//
// THE EDIT, through the surface's keys because "None [of the machine operations]
// pushes an undo entry" (`specs/instrumentation.md`): `ins-drop` at column `0` of
// the arm's row, which replaces a cell holding `grab` with a name the posed tape
// does not carry. It is read before it is undone, so a build that committed
// nothing cannot pass by having nothing to restore.
//
// THE VERDICT. After one undo the arm carries both cells of the tape it was posed
// with, in their posed order, and the one entry the write pushed is the one the
// undo took.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import type { InstructionName } from "../constants";
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

/** The arm's pose and tape as posed. */
const ARM_ROTATION = 4;
const ARM_LENGTH = 2;
const ARM_TAPE: readonly InstructionName[] = ["grab", "rotate-cw"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the arm's tape after an undone write", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, ARM_ROTATION, ARM_LENGTH, ARM_TAPE),
    ]),
  );

  const readings = await captureReplay(h, "restored", async () => {
    const posed = await h.snapshot();
    const arm = solePartOfKind(posed, "arm")?.id ?? -1;

    await h.debug.setFocus("tape");
    await h.debug.setCursor(arm, 0);
    await pressAction(h, "ins-drop");
    const edited = await h.snapshot();

    await pressAction(h, "undo");
    const undone = await h.snapshot();

    return { posed, edited, undone };
  });

  const { posed, edited, undone } = readings;
  assertEqual(
    edited.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "the tape write is one committed edit",
  );
  assertNotEqual(
    solePartOfKind(edited, "arm")?.tape?.[0],
    ARM_TAPE[0],
    "the write was committed, so the undo has a tape to restore",
  );

  const arm = solePartOfKind(undone, "arm");
  assertNotNull(arm, "the arm is on the field after the undo");

  assertDeepEqual(arm?.tape, [...ARM_TAPE], "an entry holds each arm's tape");
  assertEqual(
    undone.editor.undoDepth,
    posed.editor.undoDepth,
    "and the one entry the write pushed is the one the undo took",
  );
});
