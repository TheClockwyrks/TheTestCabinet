// editor/an-instruction-write-overwrites-the-cell — a write replaces the cell it
// lands on, leaving the cells after it where they stood.
//
// THE RULE. "Each instruction action writes its instruction at the cursor"
// (`specs/editor.md`, The tape panel) — AT the cursor, so the cell the cursor
// names holds the new instruction afterwards and the tape is no longer than it
// was. The same section's undo rule says so from the other side: "An edit that
// changes nothing, such as writing the instruction a cell already holds, commits
// nothing and pushes no entry" — a write that INSERTED would lengthen the tape
// every time, and writing the name a cell already holds could never be a write
// that changed nothing.
//
// THE TAPE'S OWN LENGTH IS PART OF THE READING. "A tape's length is the index of
// its last non-blank cell plus one" (`specs/instructions.md`), and the snapshot's
// tape "length is trimmed: the last entry is never `null`" (`specs/state.md`). A
// four-cell tape written over at column `1` is still four cells; one that inserted
// and shifted would be five.
//
// THE CONFIGURATION. One arm carrying four cells, all four different names, and
// the cursor at column `1` — an interior cell, so there are cells after it to be
// shifted. The instruction written, `advance`, is a fifth name, held by no cell of
// the tape, so a cell that reads `advance` afterwards was written rather than
// pushed along.
//
// THE VERDICT. Column `1` holds `advance`, columns `0`, `2` and `3` hold exactly
// what they held, column `4` is blank, and the tape is still four cells long.

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

/** Four cells, four different names, none of them the name the write carries. */
const TAPE: readonly InstructionName[] = [
  "grab",
  "drop",
  "rotate-cw",
  "pivot-cw",
];

it("replaces the cursor's cell and leaves the cells after it untouched", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertDeepEqual(
    cellsAt(before, arm, 0, 5),
    [...TAPE, null],
    "the arm stands with the four cells it was given",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 1);
  await pressAction(h, "ins-advance");
  await captureStill(h, "overwritten");

  const after = await h.snapshot();
  const tape = partById(after, arm)?.tape;
  assertNotNull(tape, "the arm still carries a tape after the write");
  assertDeepEqual(
    cellsAt(after, arm, 0, 5),
    ["grab", "advance", "rotate-cw", "pivot-cw", null],
    "the write replaces the cell at the cursor, leaving the cells after it where they stood",
  );
  assertLength(
    tape ?? [],
    4,
    "the tape is no longer than it was, so nothing was inserted and shifted",
  );
});
