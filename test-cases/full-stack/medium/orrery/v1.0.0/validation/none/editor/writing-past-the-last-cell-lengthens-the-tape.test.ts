// editor/writing-past-the-last-cell-lengthens-the-tape — a write at a column
// beyond the tape's end leaves a tape that reaches that column.
//
// THE RULE. "A tape has no fixed end: writing past the last cell lengthens it, and
// the cells between hold blanks" (`specs/editor.md`, The tape panel). What "past
// the last cell" means is fixed by `specs/instructions.md`: "A tape's length is the
// index of its last non-blank cell plus one", so a three-cell tape's last cell
// stands at column `2` and column `6` is four columns past it. What the cells
// between hold is decided beside this; what this item decides is that the tape
// reaches the column at all.
//
// THE TAPE'S OWN LENGTH IS READ, NOT INFERRED. The snapshot's tape "length is
// trimmed: the last entry is never `null`, and an entirely blank tape is the empty
// array" (`specs/state.md`), so its length is the tape's length as
// `specs/instructions.md` computes it. It is read back BEFORE the write, so
// "past the last cell" is measured on the machine rather than assumed.
//
// THE CONFIGURATION. One arm carrying three cells and the cursor at column `6`,
// which the cursor reaches because "`right`... moves without an upper bound". The
// instruction written, `drop`, is a name the tape does not already carry, so the
// cell that holds it afterwards was written by this press.
//
// THE VERDICT. The tape reaches at least column `6`, and column `6` holds `drop`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThanOrEqual,
  assertLength,
  assertNotNull,
} from "../assert";
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

/** Three cells, none of them the name the write past the end carries. */
const TAPE: readonly InstructionName[] = ["grab", "rotate-cw", "pivot-cw"];

it("leaves the tape long enough to hold the column written at", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertLength(
    partById(before, arm)?.tape ?? [],
    3,
    "the tape is three cells long, so its last cell stands at column 2 and column 6 is past it",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 6);
  await pressAction(h, "ins-drop");
  await captureStill(h, "lengthened");

  const after = await h.snapshot();
  const tape = partById(after, arm)?.tape;
  assertNotNull(tape, "the arm still carries a tape after the write");
  assertGreaterThanOrEqual(
    (tape ?? []).length,
    7,
    "writing past the last cell lengthens the tape, so it reaches column 6",
  );
  assertEqual(
    cellsAt(after, arm, 6, 1)[0],
    "drop",
    "and the cell written at holds the instruction the press wrote",
  );
});
