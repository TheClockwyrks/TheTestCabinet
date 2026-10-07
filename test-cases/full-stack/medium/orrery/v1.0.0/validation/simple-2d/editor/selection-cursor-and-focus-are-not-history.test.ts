// editor/selection-cursor-and-focus-are-not-history — an entry holds the machine
// alone, so an undo leaves the editor's hands where they are.
//
// THE RULE. "The entry holds the machine as it stood before the edit: the parts
// with their poses, paths, and tapes. SELECTION, CURSOR, FOCUS, AND DRAGS ARE NOT
// PART OF HISTORY" (`specs/editor.md`, Undo and redo). `specs/instrumentation.md`
// reports the three as `editor.selected`, `editor.cursor` and `editor.focus`.
//
// THE UNDO MUST REMOVE NOTHING, which is what the item's own wording fixes: "An
// undo that restores a machine STILL HOLDING THE SELECTED PART". The separate rule
// two paragraphs on — "An edit, undo, or redo that removes the selected part
// clears the selection, and one that removes the cursor's arm clears the cursor" —
// is a different item, and posing an undo that removed a part would put the two
// rules in each other's way. So the edit undone here is a TAPE WRITE: it changes a
// cell and takes nothing off the field.
//
// THE HANDS ARE POSED AFTER THE EDIT AND BEFORE THE UNDO, through `setSelected`,
// `setFocus` and `setCursor`, which `specs/instrumentation.md` lists among the
// operations that push no undo entry. They are posed to values the edit did not
// leave behind — the selection on the OTHER arm, the cursor several columns along
// the edited arm's row — so a build that restored the hands from the entry would
// be visibly restoring them rather than coincidentally agreeing.
//
// THE CONFIGURATION. Two arms with empty tapes, one at `(0, 0)` and one at
// `(3, 0)`, far enough apart that neither's grippers reach the other. The write
// lands on the arm at `(0, 0)`; the selection is left on the arm at `(3, 0)`.
//
// THE UNDO IS READ AS WELL AS THE HANDS, so a build whose undo did nothing at all
// cannot pass by leaving everything alone.
//
// THE VERDICT. After the undo the tape is blank again and the depth is back where
// it started, while `editor.selected`, `editor.cursor` and `editor.focus` read
// exactly what they read before the press.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import type { InstructionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, EAST, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  pressAction,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

/** Where the cursor is left standing: a column the write never reached. */
const HELD_COLUMN = 3;

/** How many columns of the edited tape are read, so a blank reads as a blank. */
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

it("leaves the selection, the cursor and the focus exactly as they stand", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, []),
      armPart("arm", EAST.q, EAST.r, 0, 1, []),
    ]),
  );

  const posed = await h.snapshot();
  assertLength(
    posed.editor.parts,
    2,
    "the machine stands with the two arms the scenario placed",
  );
  const written = posed.editor.parts[0]?.id ?? -1;
  const held = posed.editor.parts[1]?.id ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(written, 0);
  await pressAction(h, "ins-grab");
  const edited = await h.snapshot();

  await h.debug.setSelected(held);
  await h.debug.setFocus("tape");
  await h.debug.setCursor(written, HELD_COLUMN);
  const before = await h.snapshot();

  await pressAction(h, "undo");
  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "held");

  assertDeepEqual(
    columnsOf(edited, written),
    ["grab", null],
    "the write changed a blank cell, so there is a real edit for the undo to take",
  );
  assertEqual(
    edited.editor.undoDepth,
    posed.editor.undoDepth + 1,
    "and it pushed one entry onto the undo history",
  );
  assertEqual(
    before.editor.selected,
    held,
    "the hands are posed on the arm the write never touched",
  );
  assertDeepEqual(
    before.editor.cursor,
    { part: written, col: HELD_COLUMN },
    "and the cursor is posed at a column the write never reached",
  );
  assertEqual(
    before.editor.focus,
    "tape",
    "and the focus is on the tape panel",
  );

  assertDeepEqual(
    columnsOf(after, written),
    [null, null],
    "the undo restored the machine: the cell the write filled is blank again",
  );
  assertEqual(
    after.editor.undoDepth,
    posed.editor.undoDepth,
    "and took the one entry the write pushed",
  );
  assertLength(
    after.editor.parts,
    2,
    "the undo removed nothing: the machine still holds the selected part",
  );

  assertEqual(
    after.editor.selected,
    before.editor.selected,
    "selection is not part of history, so the undo leaves editor.selected as it stands",
  );
  assertDeepEqual(
    after.editor.cursor,
    before.editor.cursor,
    "the cursor is not part of history either",
  );
  assertEqual(
    after.editor.focus,
    before.editor.focus,
    "nor is the focus: an entry holds the machine alone",
  );
});
