// editor/ins-blank-blanks-the-cell-in-place — one `Delete` empties the cursor's
// cell and leaves the cursor standing on it.
//
// THE RULE. "`ins-blank` blanks the cell in place" (`specs/editor.md`, The tape
// panel), which is the entry `specs/controls.md` binds to `Delete` and describes
// as writing "A blank". "In place" is what separates it from every other tape
// verb on that list: the instruction actions "move the cursor one cell right" and
// `ins-erase` "moves back one", while this one moves the cursor nowhere.
//
// THE CONFIGURATION. One arm carrying three cells and the cursor at column `1`,
// an interior cell — so the blank has a cell on either side of it, and a build
// that closed the gap by pulling column `2` back would be read as such rather
// than as a blank.
//
// THE VERDICT. Column `1` is blank, columns `0` and `2` hold exactly what they
// held, and `editor.cursor` still names that arm and column `1`.

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

/** Three cells, three different names, so a shifted cell reads as one. */
const TAPE: readonly InstructionName[] = ["grab", "drop", "rotate-cw"];

it("blanks the cell the cursor names and leaves the cursor on it", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertDeepEqual(
    cellsAt(before, arm, 0, 3),
    [...TAPE],
    "the arm stands with the three cells it was given",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 1);
  await pressAction(h, "ins-blank");
  await captureStill(h, "blanked");

  const after = await h.snapshot();
  assertNotNull(
    partById(after, arm)?.tape,
    "the arm still carries a tape after the blank",
  );
  assertDeepEqual(
    cellsAt(after, arm, 0, 3),
    ["grab", null, "rotate-cw"],
    "ins-blank blanks the cursor's cell, leaving the cells either side of it alone",
  );

  const cursor = after.editor.cursor;
  assertNotNull(cursor, "the cursor still points at a cell after the blank");
  assertEqual(cursor?.part, arm, "the cursor stays on the row it blanked");
  assertEqual(
    cursor?.col,
    1,
    "ins-blank blanks the cell in place, so the cursor does not move",
  );
});
