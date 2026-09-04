// editor/undo-restores-poses-paths-and-tapes — an entry holds a pose, a path and a
// tape, so undoing past three different kinds of edit restores all three.
//
// THE RULE. "The entry holds the machine as it stood before the edit: THE PARTS
// WITH THEIR POSES, PATHS, AND TAPES", restored by "The `undo` action restores the
// machine from the latest entry" (`specs/editor.md`, Undo and redo). The three
// nouns are what this item reads, and the three edits are chosen to disturb one
// each: "rotating or resizing a part, ending a lay that changed a track, and each
// write to a tape" are all in the same list of committed edits.
//
// THE POSE, THE PATH AND THE TAPE ARE WHAT THE SNAPSHOT CALLS THEM
// (`specs/instrumentation.md`): a part's `rotation` and `length`, a track's `cells`
// and `closed`, and an arm's `tape`.
//
// THE CONFIGURATION. An arm at `(0, 0)` at rotation `4`, length `2`, carrying
// `[grab, rotate-cw]`; a two-cell open track running east from `(-2, 2)`; and a
// `bind` at `(2, -2)` unrotated, whose footprint stays on the field one step
// clockwise. None of the three parts shares a hex with another, and the arm's
// anchor is on no track cell, so nothing here is mounted and no edit reaches a
// part it was not aimed at.
//
// THE THREE EDITS, in order, each through the surface's pointer and keys because
// "None [of the machine operations] pushes an undo entry"
// (`specs/instrumentation.md`):
//
//   1. `part-cw` on the selected bind — a rotation.
//   2. A lay off the track's `last` end onto two further hexes — a path.
//   3. `ins-drop` at column `0` of the arm's row — a tape.
//
// Three undos then walk back through all three, and the machine is read against
// the poses, paths and tapes it was posed with.
//
// THE EDITS ARE READ BEFORE THEY ARE UNDONE, so a build that committed none of
// them cannot pass by having nothing to restore.
//
// THE VERDICT. After three undos the bind is unrotated, the track holds its two
// cells and is still open, and the arm carries its rotation, its length and both
// cells of its tape.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotEqual,
  assertNotNull,
} from "../assert";
import type { InstructionName } from "../constants";
import { at, hexCenter } from "../field";
import { armPart, sigilPart, solution, trackPart } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  moveTo,
  openChallengeDocument,
  pressAction,
  pressAt,
  releasePointer,
  solePartOfKind,
  type Harness,
} from "../harness";

/** The arm's pose and tape, the track's path, and the bind's rotation, as posed. */
const ARM_ROTATION = 4;
const ARM_LENGTH = 2;
const ARM_TAPE: readonly InstructionName[] = ["grab", "rotate-cw"];
const TRACK_CELLS = [at(-2, 2), at(-1, 2)];
const APPENDED = [at(0, 2), at(1, 2)];
const BIND_AT = at(2, -2);
const BIND_ROTATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores each part's rotation and length, the track's path, and the arm's tape", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, ARM_ROTATION, ARM_LENGTH, ARM_TAPE),
      trackPart(TRACK_CELLS),
      sigilPart("bind", BIND_AT.q, BIND_AT.r, BIND_ROTATION),
    ]),
  );

  const readings = await captureReplay(h, "restored", async () => {
    const posed = await h.snapshot();
    const arm = solePartOfKind(posed, "arm")?.id ?? -1;
    const bind = solePartOfKind(posed, "bind")?.id ?? -1;

    await h.debug.setFocus("field");
    await h.debug.setSelected(bind);
    await pressAction(h, "part-cw");

    await pressAt(h, hexCenter(TRACK_CELLS[1] ?? at(0, 0)));
    for (const cell of APPENDED) await moveTo(h, hexCenter(cell));
    await releasePointer(h);

    await h.debug.setFocus("tape");
    await h.debug.setCursor(arm, 0);
    await pressAction(h, "ins-drop");
    const edited = await h.snapshot();

    for (let i = 0; i < 3; i += 1) await pressAction(h, "undo");
    const undone = await h.snapshot();

    return { posed, edited, undone };
  });

  const { posed, edited, undone } = readings;
  assertEqual(
    edited.editor.undoDepth,
    posed.editor.undoDepth + 3,
    "the rotation, the lay and the tape write are three committed edits",
  );
  assertNotEqual(
    solePartOfKind(edited, "bind")?.rotation,
    BIND_ROTATION,
    "the rotation was committed, so the undo has a rotation to restore",
  );
  assertNotEqual(
    solePartOfKind(edited, "track")?.cells?.length,
    TRACK_CELLS.length,
    "the lay was committed, so the undo has a path to restore",
  );
  assertNotEqual(
    solePartOfKind(edited, "arm")?.tape?.[0],
    ARM_TAPE[0],
    "the tape write was committed, so the undo has a tape to restore",
  );

  const arm = solePartOfKind(undone, "arm");
  const track = solePartOfKind(undone, "track");
  const bind = solePartOfKind(undone, "bind");
  assertNotNull(arm, "the arm is on the field after the three undos");
  assertNotNull(track, "the track is on the field after the three undos");
  assertNotNull(bind, "the bind is on the field after the three undos");

  assertEqual(
    bind?.rotation,
    BIND_ROTATION,
    "an entry holds each part's rotation",
  );
  assertEqual(
    arm?.rotation,
    ARM_ROTATION,
    "an entry holds each part's rotation",
  );
  assertEqual(arm?.length, ARM_LENGTH, "an entry holds each part's length");
  assertDeepEqual(
    track?.cells,
    TRACK_CELLS,
    "an entry holds each track's cells",
  );
  assertEqual(track?.closed, false, "an entry holds each track's closed flag");
  assertDeepEqual(arm?.tape, [...ARM_TAPE], "an entry holds each arm's tape");
  assertEqual(
    undone.editor.undoDepth,
    posed.editor.undoDepth,
    "and the three entries the three edits pushed are the three the undos took",
  );
});
