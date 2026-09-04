// instructions/repeat-lands-the-cursor-after-the-copy — invoked at column `c`, the
// cursor comes to rest at column `2 * c`, on the row it was invoked on.
//
// THE RULE. "`ins-repeat` writes the `repeat` expansion of
// `specs/instructions.md` and lands the cursor after it" (`specs/editor.md`, The
// tape panel). Where "after it" is follows from the expansion's own size:
// `repeat` "copies the arm's own cells from index `0` up to but not including that
// cell" — `c` entries — and a macro writes "one cell per entry of the expansion"
// from the cursor onward (`specs/instructions.md`), so the copy fills columns `c`
// to `2 * c - 1` and the column after it is `2 * c`. The snapshot reports the hand
// as `editor.cursor`, "`{ part: <number>, col: <number> } | null`"
// (`specs/instrumentation.md`).
//
// THE CONFIGURATION. Two arms, so "the same row" is a claim that can fail: the
// panel "shows one row per arm and wheel, in placement order" (`specs/editor.md`),
// and the cursor is pointed at the FIRST of the two while a second stands beside
// it. The cursor's arm carries four cells and the cursor is at column `4`, so the
// copy fills columns `4` to `7` and `2 * c` is column `8`.
//
// THE COPY'S LAST COLUMN IS READ BACK RATHER THAN ASSUMED. Column `7` carries an
// instruction and column `8` is blank, so "after the copy" is anchored to where
// the writing actually stopped before the cursor is compared against it.
//
// THE VERDICT. `editor.cursor` names the arm the macro was invoked on and column
// `8`.

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

it("leaves the cursor on the same row, at twice the column it was invoked at", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", 0, 0, 0, 1, ["grab", "rotate-cw", "pivot-cw", "drop"]),
      armPart("arm", 3, 0, 0, 1, ["grab", "drop"]),
    ]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 4);
  await pressAction(h, "ins-repeat");
  await captureStill(h, "cursor");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertNotNull(
    cellsAt(written, arm, 7, 1)[0],
    "the copy is four cells long, so its last one stands at column 7",
  );
  assertDeepEqual(
    cellsAt(written, arm, 8, 1),
    [null],
    "and column 8 is the first the copy did not write",
  );

  const cursor = written.editor.cursor;
  assertNotNull(cursor, "the cursor is still pointing at a cell after the macro");
  assertEqual(
    cursor?.part,
    arm,
    "the cursor stays on the row the macro was invoked on",
  );
  assertEqual(
    cursor?.col,
    8,
    "and lands at column 2 * c, immediately after the last copied cell",
  );
});
