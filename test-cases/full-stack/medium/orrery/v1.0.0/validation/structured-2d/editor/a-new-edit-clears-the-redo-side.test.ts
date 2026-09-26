// editor/a-new-edit-clears-the-redo-side — committing an edit while undone edits
// were waiting abandons that branch outright.
//
// THE RULE. "A new committed edit clears the redo side" (`specs/editor.md`, Undo
// and redo). What that is for is the sentence it sits between: `redo`
// "re-applies the latest undone edit", and once a different edit has been
// committed there is no such edit to re-apply, so the side is emptied rather than
// left holding a branch the machine has departed from.
//
// THE READING IS BOTH HALVES. `editor.redoDepth` reading `0` is the figure the
// item names, and a press of `redo` afterwards is what shows the figure is not
// merely a number: nothing comes back, so no edit of the abandoned branch is
// re-applied.
//
// THE CONFIGURATION. One arm at `(0, 0)` with an EMPTY tape, alone on the field.
// Two writes at the cursor — `ins-grab` then `ins-rotate-cw`, each landing on a
// blank cell — are two committed edits; two undos then leave a redo side of two.
// The new edit is a THIRD write, `ins-drop` at column `0`, which is a different
// instruction from the one the abandoned branch put there, so a redo that
// re-applied the branch would be visible in the tape as well as in the depth.
//
// THE TAPE IS READ AS COLUMNS. "A cell at or past the tape's own length is blank"
// (`specs/instructions.md`), and `specs/formats.md` trims a tape's trailing blanks,
// so a column is read as the cell it holds or as a blank.
//
// THE VERDICT. `editor.redoDepth` reads `0` after the new edit, and the redo press
// that follows leaves `editor.parts`, `editor.undoDepth` and `editor.redoDepth`
// exactly as the new edit left them.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import type { InstructionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureReplay,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  pressAction,
  solePartOfKind,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** How many columns of the tape are read, so a blank reads as a blank. */
const COLUMNS = 3;

/** The tape's first {@link COLUMNS} columns, as columns rather than as a list. */
function columnsOf(
  snapshot: OrrerySnapshot,
  part: number,
): (InstructionName | null)[] {
  const tape = partById(snapshot, part)?.tape ?? [];
  return Array.from({ length: COLUMNS }, (_unused, i) => tape[i] ?? null);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads a redo depth of 0 after the new edit, and redo re-applies nothing", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  );

  const readings = await captureReplay(h, "cleared", async () => {
    const posed = await h.snapshot();
    const arm = solePartOfKind(posed, "arm")?.id ?? -1;

    await h.debug.setFocus("tape");
    await h.debug.setCursor(arm, 0);
    await pressAction(h, "ins-grab");
    await pressAction(h, "ins-rotate-cw");

    await pressAction(h, "undo");
    await pressAction(h, "undo");
    const waiting = await h.snapshot();

    await h.debug.setCursor(arm, 0);
    await pressAction(h, "ins-drop");
    const committed = await h.snapshot();

    await pressAction(h, "redo");
    const after = await h.snapshot();

    return { posed, arm, waiting, committed, after };
  });

  const { posed, arm, waiting, committed, after } = readings;
  assertNotNull(
    solePartOfKind(posed, "arm"),
    "the machine stands with one arm for the writes to land on",
  );
  assertEqual(
    waiting.editor.redoDepth,
    posed.editor.redoDepth + 2,
    "two undos leave two edits waiting on the redo side",
  );
  assertDeepEqual(
    columnsOf(waiting, arm),
    [null, null, null],
    "and the two undos took the branch's writes back off the tape",
  );

  assertDeepEqual(
    columnsOf(committed, arm),
    ["drop", null, null],
    "the new edit wrote drop at column 0, which the abandoned branch never held there",
  );
  assertEqual(
    committed.editor.redoDepth,
    0,
    "a new committed edit clears the redo side",
  );
  assertEqual(
    committed.editor.undoDepth,
    waiting.editor.undoDepth + 1,
    "and pushes its own entry onto the undo side",
  );

  assertDeepEqual(
    columnsOf(after, arm),
    ["drop", null, null],
    "redo does not re-apply an edit from the abandoned branch",
  );
  assertDeepEqual(
    after.editor.parts,
    committed.editor.parts,
    "the redo press left the machine exactly as the new edit left it",
  );
  assertEqual(after.editor.redoDepth, 0, "and the redo side is still empty");
  assertEqual(
    after.editor.undoDepth,
    committed.editor.undoDepth,
    "and the undo side is untouched",
  );
});
