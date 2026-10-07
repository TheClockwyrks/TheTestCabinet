// editor/undo-restores-poses — an entry holds the parts with their poses, so one
// undo past a rotation puts the pose back.
//
// THE RULE. "The entry holds the machine as it stood before the edit: the parts
// WITH THEIR POSES, paths, and tapes", restored by "The `undo` action restores the
// machine from the latest entry" (`specs/editor.md`, Undo and redo). The pose is
// what the snapshot calls a part's `rotation` and `length`
// (`specs/instrumentation.md`), and the two are fields of one snapshotted part, so
// they are read together rather than as separate points. The edit that disturbs a
// pose comes from the same file's list of committed edits: "rotating or resizing a
// part".
//
// THE CONFIGURATION IS THE POSE AND NOTHING ELSE. A `bind` at `(2, -2)` unrotated,
// whose footprint stays on the field one step clockwise, and an arm at `(0, 0)` at
// rotation `4`, length `2` whose pose the rotation must leave alone. Neither
// shares a hex with the other and the arm's anchor is on no track cell, so nothing
// is mounted and the edit reaches no part it was not aimed at. What an entry does
// for a track's path is `undo-restores-track-paths`, and for an arm's tape
// `undo-restores-tapes`; each poses its own world and stages its own single edit,
// so no one of the three can only pass while the other two commit.
//
// THE EDIT, through the surface's keys because "None [of the machine operations]
// pushes an undo entry" (`specs/instrumentation.md`): `part-cw` on the selected
// bind. It is read before it is undone, so a build that committed nothing cannot
// pass by having nothing to restore.
//
// THE VERDICT. After one undo the bind stands at the rotation it was posed at, the
// arm carries its own rotation and length untouched, and the one entry the edit
// pushed is the one the undo took.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNotNull } from "../assert";
import type { InstructionName } from "../constants";
import { at } from "../field";
import { armPart, sigilPart, solution } from "../formats";
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

/** The arm's pose, and the bind's rotation, as posed. */
const ARM_ROTATION = 4;
const ARM_LENGTH = 2;
const ARM_TAPE: readonly InstructionName[] = ["grab", "rotate-cw"];
const BIND_AT = at(2, -2);
const BIND_ROTATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores each part's rotation and length after an undone rotation", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, ARM_ROTATION, ARM_LENGTH, ARM_TAPE),
      sigilPart("bind", BIND_AT.q, BIND_AT.r, BIND_ROTATION),
    ]),
  );

  const readings = await captureReplay(h, "restored", async () => {
    const posed = await h.snapshot();
    const bind = solePartOfKind(posed, "bind")?.id ?? -1;

    await h.debug.setFocus("field");
    await h.debug.setSelected(bind);
    await pressAction(h, "part-cw");
    const edited = await h.snapshot();

    await pressAction(h, "undo");
    const undone = await h.snapshot();

    return { posed, edited, undone };
  });

  const { posed, edited, undone } = readings;
  assertEqual(
    edited.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "the rotation is one committed edit",
  );
  assertNotEqual(
    solePartOfKind(edited, "bind")?.rotation,
    BIND_ROTATION,
    "the rotation was committed, so the undo has a pose to restore",
  );

  const arm = solePartOfKind(undone, "arm");
  const bind = solePartOfKind(undone, "bind");
  assertNotNull(arm, "the arm is on the field after the undo");
  assertNotNull(bind, "the bind is on the field after the undo");

  assertEqual(
    bind?.rotation,
    BIND_ROTATION,
    "an entry holds each part's rotation",
  );
  assertEqual(
    arm?.rotation,
    ARM_ROTATION,
    "an entry holds each part's rotation, the ones the edit never touched included",
  );
  assertEqual(arm?.length, ARM_LENGTH, "an entry holds each part's length");
  assertEqual(
    undone.editor.undoDepth,
    posed.editor.undoDepth,
    "and the one entry the edit pushed is the one the undo took",
  );
});
