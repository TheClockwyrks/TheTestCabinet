// instructions/repeat-copies-past-end-cells-as-blanks — the copy has one entry per
// column of the prefix, and a column at or past the tape's end contributes a blank.
//
// THE RULE. `repeat` "copies the arm's own cells from index `0` up to but not
// including that cell, blanks included" (`specs/instructions.md`, `repeat`), and
// the same file says what a cell out there is: "A tape's length is the index of
// its last non-blank cell plus one... a cell at or past the tape's own length is
// blank" (Tapes and the period). So a cursor beyond the tape's end reads a prefix
// of blanks past that end rather than a shorter prefix. The write is then "one
// cell per entry of the expansion" from the cursor onward (The two macros).
//
// THE CONFIGURATION. One arm at the origin at rotation `0` and length `1`, on no
// track, carrying two cells: `grab` and `drop`, so its length is `2`. The cursor
// is pointed at column `5`. The prefix is therefore five cells — the tape's `grab`
// and `drop`, then columns `2`, `3` and `4`, each at or past the tape's length and
// so blank — and the copy lands on columns `5` through `9`.
//
// HOW MANY ENTRIES THE COPY HAS IS READ FROM THE CURSOR, because trailing blanks
// leave no mark on a tape: `specs/formats.md` requires a tape's "last entry" to be
// "an instruction", so the three blanks written at columns `7`, `8` and `9` are
// not cells the tape keeps. What they do leave is the landing place of the hand:
// "`ins-repeat` writes the `repeat` expansion of `specs/instructions.md` and lands
// the cursor after it" (`specs/editor.md`), and after five entries written from
// column `5` is column `10`. A build that copied only the two cells that exist
// lands the cursor at column `7` instead.
//
// THE VERDICT. Columns `5` and `6` hold `grab` and `drop`, columns `7`, `8` and
// `9` are blank, and the cursor rests at column `10`.

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

it("reads three blanks past the tape's end into a five-cell copy", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([armPart("arm", 0, 0, 0, 1, ["grab", "drop"])]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertNotNull(
    partById(before, arm)?.tape,
    "the arm carries a tape for the macro to read",
  );
  assertDeepEqual(
    cellsAt(before, arm, 0, 5),
    ["grab", "drop", null, null, null],
    "the tape's length is 2, so columns 2, 3 and 4 are at or past its end",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 5);
  await pressAction(h, "ins-repeat");
  await captureStill(h, "past-end-copy");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, arm, 5, 5),
    ["grab", "drop", null, null, null],
    "the tape's two cells are written into columns 5 and 6, and the three " +
      "columns at or past its end are written as blanks",
  );

  const cursor = written.editor.cursor;
  assertNotNull(
    cursor,
    "the cursor is still pointing at a cell after the macro",
  );
  assertEqual(
    cursor?.part,
    arm,
    "the cursor stays on the row the macro was invoked on",
  );
  assertEqual(
    cursor?.col,
    10,
    "and lands after five written cells rather than after two: the columns at " +
      "or past the tape's end are entries of the copy, not cells it skipped",
  );
});
