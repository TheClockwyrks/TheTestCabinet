// editor/ins-erase-does-nothing-at-column-zero — at column `0` the erase is inert:
// no cell goes blank, the cursor does not move, and no entry reaches the history.
//
// THE RULE. "`ins-erase` blanks the cell before the cursor and moves back one, and
// does nothing at column `0`" (`specs/editor.md`, The tape panel). There is no
// cell before column `0` to blank, and "does nothing" reaches the history too:
// "Every committed edit to the machine pushes one entry onto the undo history...
// An edit that changes nothing... commits nothing and pushes no entry"
// (`specs/editor.md`, Undo and redo). The snapshot carries the depth as
// `editor.undoDepth` (`specs/instrumentation.md`).
//
// THE DEPTH IS READ AS A RISE, NOT AS A VALUE. What the history holds when the
// scenario is posed belongs to the operations that posed it; what this item
// decides is that the erase moved it by nothing at all.
//
// THE CONFIGURATION. Two arms, so the two ways a build might find something to
// erase at column `0` are both on the field: the row ABOVE, which a cursor that
// wrapped would land on, and the cursor's own row. The cursor is pointed at the
// SECOND arm's column `0`, and both tapes are read back afterwards.
//
// THE VERDICT. Both tapes hold exactly what they held, `editor.cursor` still names
// the second arm and column `0`, and `editor.undoDepth` is exactly what it was.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import type { InstructionName } from "../constants";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadMachine,
  openChallengeDocument,
  partById,
  partIds,
  pressAction,
  type Harness,
  type OrrerySnapshot,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The tape's columns `from` onward, as columns rather than as a trimmed list.
 *
 * "A cell at or past the tape's own length is blank" (`specs/instructions.md`),
 * and `specs/formats.md` trims a tape's trailing blanks away, so a column is read
 * as the cell it holds or as a blank.
 */
function cellsAt(
  snapshot: OrrerySnapshot,
  part: number,
  from: number,
  count: number,
): (InstructionName | null)[] {
  const tape = partById(snapshot, part)?.tape ?? [];
  return Array.from({ length: count }, (_unused, i) => tape[from + i] ?? null);
}

/** The row above the cursor's, which a cursor that wrapped would erase into. */
const ABOVE: readonly InstructionName[] = ["rotate-cw", "pivot-cw"];

/** The cursor's own row. */
const CURSOR_ROW: readonly InstructionName[] = ["grab", "drop"];

it("blanks no cell, moves no cursor and pushes no entry at column 0", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", -3, 0, 0, 1, ABOVE),
      armPart("arm", 0, 0, 0, 1, CURSOR_ROW),
    ]),
  );
  const ids = await partIds(h);
  const above = ids[0] ?? -1;
  const arm = ids[1] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 0);

  const before = await h.snapshot();
  assertEqual(
    before.editor.cursor?.col,
    0,
    "the cursor stands at column 0, which is where the erase does nothing",
  );
  const depth = before.editor.undoDepth;

  await pressAction(h, "ins-erase");
  await captureStill(h, "inert");

  const after = await h.snapshot();
  assertNotNull(
    partById(after, arm)?.tape,
    "the arm still carries a tape after the inert erase",
  );
  assertDeepEqual(
    cellsAt(after, arm, 0, 2),
    [...CURSOR_ROW],
    "the cursor's own row is untouched: there is no cell before column 0 to blank",
  );
  assertDeepEqual(
    cellsAt(after, above, 0, 2),
    [...ABOVE],
    "and the row above is untouched: the erase does not reach back into another row",
  );

  const cursor = after.editor.cursor;
  assertNotNull(cursor, "the cursor still points at a cell after the erase");
  assertEqual(cursor?.part, arm, "the cursor stays on the row it stood on");
  assertEqual(
    cursor?.col,
    0,
    "and stays at column 0 rather than going negative",
  );
  assertEqual(
    after.editor.undoDepth,
    depth,
    "an erase that changed nothing commits nothing, so no entry reaches the history",
  );
});
