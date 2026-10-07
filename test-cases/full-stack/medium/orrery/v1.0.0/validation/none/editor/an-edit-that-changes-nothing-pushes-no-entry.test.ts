// editor/an-edit-that-changes-nothing-pushes-no-entry — writing the instruction a
// cell already holds pushes nothing, so the undo after it reaches past it.
//
// THE RULE, and the specification's own example of it: "An edit that changes
// nothing, SUCH AS WRITING THE INSTRUCTION A CELL ALREADY HOLDS, commits nothing
// and pushes no entry" (`specs/editor.md`, Undo and redo). What that costs the
// history is the point: with no entry pushed, "The `undo` action restores the
// machine from the latest entry" reaches the previous REAL edit rather than a
// no-op standing in front of it.
//
// HOW THE WRITES ARE DRIVEN. "Each instruction action writes its instruction at
// the cursor and moves the cursor one cell right" (`specs/editor.md`, The tape
// panel), with `ins-grab` on `KeyG` (`specs/controls.md`). The cursor is put back
// to column `0` between the two presses through `setCursor`, which
// `specs/instrumentation.md` lists among the operations that push no undo entry —
// and the cursor is not part of history in any case.
//
// THE CONFIGURATION. One arm at `(0, 0)` with an EMPTY tape, alone on the field.
// The first press writes `grab` into a blank cell, which changes it, so it is a
// committed edit and there is a real entry for the undo at the end to find. The
// second press writes `grab` into the cell that first press left holding `grab`,
// which changes nothing.
//
// THE VERDICT. `editor.undoDepth` after the second press reads exactly what it
// read after the first, the tape is untouched by the second press, and one undo
// then empties the cell — the first press's doing — rather than reverting a no-op.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import type { ActionName, InstructionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  pressAction,
  solePartOfKind,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** The action both presses fire, the instruction it writes, and the column. */
const ACTION: ActionName = "ins-grab";
const WRITES: InstructionName = "grab";
const COLUMN = 0;

/** How many columns of the tape are read, so a blank reads as a blank. */
const COLUMNS = 2;

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

it("leaves the undo depth as it stands, so one undo reverts the previous real edit", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, [])]),
  );

  const posed = await h.snapshot();
  const arm = solePartOfKind(posed, "arm")?.id ?? -1;
  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, COLUMN);

  await pressAction(h, ACTION);
  const real = await h.snapshot();

  await h.debug.setCursor(arm, COLUMN);
  await pressAction(h, ACTION);
  const again = await h.snapshot();

  await pressAction(h, "undo");
  const undone = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "unchanged");

  assertNotNull(
    solePartOfKind(posed, "arm"),
    "the machine stands with one arm for the writes to land on",
  );
  assertDeepEqual(
    columnsOf(posed, arm),
    [null, null],
    "the arm carries an empty tape, so the first write changes the cell it lands on",
  );

  assertDeepEqual(
    columnsOf(real, arm),
    [WRITES, null],
    "the first press wrote grab into a blank cell: a real edit",
  );
  assertEqual(
    real.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "that write changed the tape, so it pushed one entry",
  );

  assertDeepEqual(
    columnsOf(again, arm),
    [WRITES, null],
    "the second press wrote the instruction the cell already held: the tape is unchanged",
  );
  assertEqual(
    again.editor.undoDepth,
    real.editor.undoDepth,
    "an edit that changes nothing commits nothing and pushes no entry",
  );

  assertNotNull(
    solePartOfKind(undone, "arm"),
    "the arm is still on the field after the undo",
  );
  assertDeepEqual(
    columnsOf(undone, arm),
    [null, null],
    "with no entry in front of it, one undo reverts the previous real edit",
  );
  assertEqual(
    undone.editor.undoDepth,
    posed.editor.undoDepth,
    "and that leaves the history where the scenario found it",
  );
});
