// instructions/repeat-is-one-undo-entry — a whole copy is one entry on the undo
// history, and one undo takes all of it back.
//
// THE RULE. "Every committed edit to the machine pushes one entry onto the undo
// history: placing, moving, or deleting a part, ending a lay that changed a track,
// rotating or resizing a part, and each write to a tape, the macros counting as
// one edit apiece" (`specs/editor.md`, Undo and redo). What the entry holds is
// stated in the next sentence: "The entry holds the machine as it stood before the
// edit: the parts with their poses, paths, and tapes", and "The `undo` action
// restores the machine from the latest entry". The snapshot reports the depth as
// `editor.undoDepth` (`specs/instrumentation.md`).
//
// THE DEPTH IS READ AS A RISE, NOT AS A VALUE. What the history holds when the
// scenario is posed belongs to the operations that posed it; what this item
// decides is that ONE repeat moves it by exactly one, so the depth before the key
// is pressed is measured and compared against the depth after.
//
// THE COPY IS DELIBERATELY SEVERAL CELLS LONG. A macro that pushed one entry per
// cell it wrote would raise the depth by three here rather than by one, and a
// single undo would then restore only the last of the three cells. So the check
// reads both halves of the rule: the depth moved by one, and one undo put every
// column of the tape back — the cells the copy overwrote and the cells it did not
// touch alike.
//
// THE CONFIGURATION. One arm at the origin at rotation `0` and length `1`, on no
// track, carrying seven cells whose first three share no name with the four from
// the cursor onward. Invoked at column `3`, the copy is those first three cells
// written over columns `3`, `4` and `5`.
//
// THE VERDICT. `editor.undoDepth` rises by exactly `1`, and after one `undo` every
// column of the tape holds what it held before the macro ran.

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

/** Three cells before the cursor, four after it, sharing no name across the cursor. */
const TAPE: readonly InstructionName[] = [
  "grab",
  "rotate-cw",
  "pivot-cw",
  "drop",
  "extend",
  "retract",
  "pivot-ccw",
];

/** The tape as columns, so a blank column reads as a blank rather than as nothing. */
const COLUMNS: (InstructionName | null)[] = [...TAPE, null];

it("raises the undo depth by one, and one undo restores the whole tape", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertNotNull(
    partById(before, arm)?.tape,
    "the arm carries a tape for the macro to write over",
  );
  assertDeepEqual(
    cellsAt(before, arm, 0, COLUMNS.length),
    COLUMNS,
    "the arm stands with the tape it was given",
  );
  const depth = before.editor.undoDepth;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 3);
  await pressAction(h, "ins-repeat");

  const written = await h.snapshot();

  await pressAction(h, "undo");
  await captureStill(h, "one-undo");
  const undone = await h.snapshot();

  assertDeepEqual(
    cellsAt(written, arm, 3, 3),
    ["grab", "rotate-cw", "pivot-cw"],
    "the macro wrote three cells, so what one undo has to take back is three",
  );
  assertEqual(
    written.editor.undoDepth,
    depth + 1,
    "a macro counts as one edit apiece, whatever it wrote",
  );
  assertNotNull(
    partById(undone, arm)?.tape,
    "the arm still carries a tape after the undo",
  );
  assertDeepEqual(
    cellsAt(undone, arm, 0, COLUMNS.length),
    COLUMNS,
    "one undo restores every cell of the tape to what it held before the macro",
  );
  assertEqual(
    undone.editor.undoDepth,
    depth,
    "and the one entry the macro pushed is the one the undo took",
  );
});
