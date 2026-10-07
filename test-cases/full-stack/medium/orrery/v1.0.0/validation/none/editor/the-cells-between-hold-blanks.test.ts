// editor/the-cells-between-hold-blanks — the columns a write past the end skipped
// over are blanks, not copies and not nothing.
//
// THE RULE. "A tape has no fixed end: writing past the last cell lengthens it, and
// the cells between hold blanks" (`specs/editor.md`, The tape panel). "The cells
// between" are the columns from the old end up to the column written at, and a
// blank is a cell like any other: "Every arm and wheel carries a tape: a row of
// cells indexed from `0`, each blank or holding one instruction"
// (`specs/instructions.md`). The snapshot reports a blank cell as `null` within
// the tape (`specs/state.md`).
//
// THE CONFIGURATION. One arm carrying three cells, so the tape's last cell stands
// at column `2` ("A tape's length is the index of its last non-blank cell plus
// one", `specs/instructions.md`), and the write lands at column `6`. Columns `3`,
// `4` and `5` are the cells between. Every cell of the original tape holds a
// different name, so a build that repeated one of them into the gap is read as the
// name it repeated rather than as an unexplained cell.
//
// THE VERDICT. Columns `3`, `4` and `5` are blank, columns `0` to `2` hold exactly
// what they held, and column `6` holds the instruction written.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, assertNotNull } from "../assert";
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

/** Three cells, three different names, none of them the one written past the end. */
const TAPE: readonly InstructionName[] = ["grab", "rotate-cw", "pivot-cw"];

it("leaves columns 3, 4 and 5 blank when column 6 is written", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertLength(
    partById(before, arm)?.tape ?? [],
    3,
    "the tape's last cell stands at column 2, so columns 3 to 5 are the cells between",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 6);
  await pressAction(h, "ins-drop");
  await captureStill(h, "gap");

  const after = await h.snapshot();
  assertNotNull(
    partById(after, arm)?.tape,
    "the arm still carries a tape after the write",
  );
  assertDeepEqual(
    cellsAt(after, arm, 0, 7),
    ["grab", "rotate-cw", "pivot-cw", null, null, null, "drop"],
    "the cells between the old end and the column written at hold blanks",
  );
});
