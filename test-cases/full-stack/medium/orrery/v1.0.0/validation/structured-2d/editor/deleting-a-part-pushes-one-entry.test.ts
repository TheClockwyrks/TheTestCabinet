// editor/deleting-a-part-pushes-one-entry — a `part-delete` press is one edit, and
// one undo hands the deleted part back whole.
//
// THE RULE. "Every committed edit to the machine pushes one entry onto the undo
// history: placing, moving, or deleting a part, ending a lay that changed a track,
// rotating or resizing a part, and each write to a tape, the macros counting as
// one edit apiece. ... The entry holds the machine as it stood before the edit:
// the parts with their poses, paths, and tapes" (`specs/editor.md`, Undo and
// redo). What one undo then does is the next paragraph: "The `undo` action
// restores the machine from the latest entry". The press itself is
// `specs/controls.md`'s `part-delete` on `KeyX`, which `specs/editor.md` routes
// under field focus: "the field-focus actions of `specs/controls.md` act on the
// selected part: ... `part-delete` removes any part."
//
// THE DEPTH IS READ AS A RISE, NOT AS A VALUE. What the history holds when the
// scenario is posed belongs to the operations that posed it — and
// `specs/instrumentation.md` says none of them pushes an entry — so what this
// item decides is that ONE press moves the depth by exactly one. The depth before
// the key is pressed is measured and compared against the depth after.
//
// THE CONFIGURATION. One challenge, one machine, two deletions, because the
// sentence names three things an entry holds and no single part carries them all:
// an ARM at `(0, 0)` at rotation `2`, length `2`, carrying a two-cell tape — a
// pose and a tape — and a three-cell open TRACK at `(-2, 2)` — a pose and a path.
// Each is selected through `setSelected`, which "pushes no undo entry", and
// deleted with one press; each deletion is undone before the next is made, so the
// second press is measured from a history the first left as it found it. Neither
// part is on a hex of the other, and the arm's grippers reach neither.
//
// AND THE PART THAT COMES BACK IS THE PART THAT WENT. "A part an entry restores
// is the part it was, its identity included, so a selection or a cursor that
// named it names it still, and only a part the restored machine does not hold
// counts as removed" (`specs/editor.md`, Undo and redo). "Whole" therefore takes
// in the id as well as the pose, the path and the tape, so each undo is read on
// the id the deletion took away rather than on whatever part of that kind the
// machine now holds.
//
// THE VERDICT. `editor.undoDepth` rises by exactly `1` on each press, the part is
// off the field afterwards, and one undo puts it back under the id it had, with
// the rotation, length and tape it had, or with the path and the `closed` flag it
// had.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import type { InstructionName } from "../constants";
import { at } from "../field";
import { armPart, solution, trackPart } from "../formats";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  solePartOfKind,
  pressAction,
  type Harness,
} from "../harness";

/** The arm's pose and tape, which one undo has to hand back. */
const ARM_AT = at(0, 0);
const ARM_ROTATION = 2;
const ARM_LENGTH = 2;
const ARM_TAPE: readonly InstructionName[] = ["grab", "rotate-cw"];

/** The track's path, which one undo has to hand back. */
const TRACK_CELLS = [at(-2, 2), at(-1, 2), at(0, 2)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Select `part` and press `part-delete` under field focus, the player's route. */
async function deleteSelected(part: number): Promise<void> {
  await h.debug.setFocus("field");
  await h.debug.setSelected(part);
  await pressAction(h, "part-delete");
}

it("raises the undo depth by one per deletion, and one undo returns the part whole", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", ARM_AT.q, ARM_AT.r, ARM_ROTATION, ARM_LENGTH, ARM_TAPE),
      trackPart(TRACK_CELLS),
    ]),
  );

  const readings = await captureReplay(h, "undone", async () => {
    const posed = await h.snapshot();
    const arm = solePartOfKind(posed, "arm");
    const track = solePartOfKind(posed, "track");

    await deleteSelected(arm?.id ?? -1);
    const armGone = await h.snapshot();
    await pressAction(h, "undo");
    const armBack = await h.snapshot();

    await deleteSelected(track?.id ?? -1);
    const trackGone = await h.snapshot();
    await pressAction(h, "undo");
    const trackBack = await h.snapshot();

    return { posed, arm, track, armGone, armBack, trackGone, trackBack };
  });

  const { posed, arm, track } = readings;
  assertNotNull(
    arm,
    "the machine stands with one arm for the first press to delete",
  );
  assertNotNull(
    track,
    "the machine stands with one track for the second press to delete",
  );

  assertNull(
    partById(readings.armGone, arm?.id ?? -1),
    "the part-delete press took the selected arm off the field",
  );
  assertEqual(
    readings.armGone.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "deleting a part pushes exactly one entry onto the undo history",
  );

  const restoredArm = partById(readings.armBack, arm?.id ?? -1);
  assertNotNull(
    restoredArm,
    "one undo restores the machine, so the arm is on the field again as the part it was",
  );
  assertEqual(restoredArm?.q, ARM_AT.q, "the entry held the arm's anchor");
  assertEqual(restoredArm?.r, ARM_AT.r, "the entry held the arm's anchor");
  assertEqual(
    restoredArm?.rotation,
    ARM_ROTATION,
    "the entry held the arm's pose: its rotation",
  );
  assertEqual(
    restoredArm?.length,
    ARM_LENGTH,
    "the entry held the arm's pose: its length",
  );
  assertDeepEqual(
    restoredArm?.tape,
    [...ARM_TAPE],
    "the entry held the arm's tape",
  );
  assertEqual(
    readings.armBack.editor.undoDepth,
    posed.editor.undoDepth,
    "and the one entry the deletion pushed is the one the undo took",
  );

  assertNull(
    partById(readings.trackGone, track?.id ?? -1),
    "the second part-delete press took the selected track off the field",
  );
  assertEqual(
    readings.trackGone.editor.undoDepth,
    readings.armBack.editor.undoDepth + 1,
    "deleting the track pushes exactly one entry, measured from the history the undo left",
  );

  const restoredTrack = partById(readings.trackBack, track?.id ?? -1);
  assertNotNull(
    restoredTrack,
    "one undo restores the machine, so the track is on the field again as the part it was",
  );
  assertDeepEqual(
    restoredTrack?.cells,
    TRACK_CELLS,
    "the entry held the track's path, in order",
  );
  assertEqual(
    restoredTrack?.closed,
    false,
    "the entry held the track's closed flag",
  );
  assertEqual(
    readings.trackBack.editor.undoDepth,
    readings.armBack.editor.undoDepth,
    "and the one entry the second deletion pushed is the one the second undo took",
  );
});
