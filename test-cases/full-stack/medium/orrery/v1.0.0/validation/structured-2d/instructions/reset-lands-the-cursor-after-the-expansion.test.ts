// instructions/reset-lands-the-cursor-after-the-expansion — the cursor comes to
// rest one column past the last cell the macro wrote, on the row it was invoked on.
//
// THE RULE. "`ins-reset` writes the `reset` expansion of `specs/instructions.md`
// and lands the cursor after it" (`specs/editor.md`, The tape panel). Where "after
// it" is follows from how the expansion is laid down: "A macro writes its
// expansion into the cells from the cursor onward, one cell per entry of the
// expansion" (`specs/instructions.md`), so an expansion of `n` entries invoked at
// column `c` ends at column `c + n - 1` and the column after it is `c + n`. The
// snapshot reports the hand as `editor.cursor`, "`{ part: <number>, col: <number>
// } | null`" (`specs/instrumentation.md`).
//
// THE CONFIGURATION. Two arms, so "the same row" is a claim that can fail: the
// panel "shows one row per arm and wheel, in placement order" (`specs/editor.md`),
// and the cursor is pointed at the FIRST of the two while a second stands beside
// it. The cursor's arm is at the origin at rotation `0` and length `1`, on no
// track, carrying three `rotate-cw`; invoked at column `3`, the expansion is
// `drop` and a three-step rotation run, four cells, filling columns `3` to `6`.
//
// THE EXPANSION'S LAST COLUMN IS READ BACK RATHER THAN ASSUMED. Column `6` carries
// an instruction and column `7` is blank, so "after the expansion" is anchored to
// where the writing actually stopped before the cursor is compared against it.
// Which instructions those four cells hold is decided elsewhere; what this item
// decides is where the hand is left.
//
// THE VERDICT. `editor.cursor` names the arm the macro was invoked on and column
// `7`.

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

it("leaves the cursor on the same row, one column past the expansion", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw", "rotate-cw", "rotate-cw"]),
      armPart("arm", 3, 0, 0, 1, ["grab", "drop"]),
    ]),
  );
  const ids = await partIds(h);
  const arm = ids[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 3);
  await pressAction(h, "ins-reset");
  await captureStill(h, "cursor");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertNotNull(
    cellsAt(written, arm, 6, 1)[0],
    "the expansion is four cells long, so its last one stands at column 6",
  );
  assertDeepEqual(
    cellsAt(written, arm, 7, 1),
    [null],
    "and column 7 is the first the expansion did not write",
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
    7,
    "and lands at the column immediately after the last cell the expansion wrote",
  );
});
