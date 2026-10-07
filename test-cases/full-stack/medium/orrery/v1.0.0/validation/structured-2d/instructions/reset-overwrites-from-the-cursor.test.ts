// instructions/reset-overwrites-from-the-cursor — the expansion replaces the cells
// from the cursor onward rather than being pushed in front of them.
//
// THE RULE. "A macro writes its expansion into the cells from the cursor onward,
// one cell per entry of the expansion, and reaches no further: every cell before
// the cursor and every cell past the expansion's last is left exactly as it was"
// (`specs/instructions.md`, The two macros). `specs/editor.md` says the same of
// the key that invokes it: "`ins-reset` writes the `reset` expansion of
// `specs/instructions.md`".
//
// AN INSERT AND AN OVERWRITE DIFFER IN THREE PLACES, so the tape is posed long
// enough on both sides of the cursor for all three to be read. Ahead of the
// cursor, columns `0` to `2` must be untouched. At the cursor, column `3` must
// hold the expansion's FIRST instruction rather than the cell that stood there.
// Behind the expansion, the cell that stood at column `6` must still be at column
// `6` — an insert would have carried it to column `9` — and column `7` must still
// be blank.
//
// THE CONFIGURATION. One arm at the origin at rotation `0` and length `1`, its
// rest pose, on no track, carrying a seven-cell tape. The three cells before the
// cursor are `grab` and two `rotate-cw`, so the walk at column `3` stands two
// rotation steps clockwise of rest and the expansion is `drop` and two
// `rotate-ccw` — three cells, against the four cells of tape that stand from the
// cursor onward. The cells the expansion lands on are `pivot-cw`, `pivot-ccw` and
// `grab`, and the cell past it is `recede`: four names none of which the
// expansion writes, so a cell that survived is unmistakable.
//
// THE VERDICT. The prefix reads as it was written, the cursor's column holds
// `drop`, and `recede` still stands at column `6` with a blank after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
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

/** Three cells before the cursor, four after it, none of them a name reset writes. */
const TAPE: readonly InstructionName[] = [
  "grab",
  "rotate-cw",
  "rotate-cw",
  "pivot-cw",
  "pivot-ccw",
  "grab",
  "recede",
];

it("overwrites from the cursor, leaving the prefix and the tail where they were", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 3);
  await pressAction(h, "ins-reset");
  await captureStill(h, "overwritten");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, arm, 0, 3),
    ["grab", "rotate-cw", "rotate-cw"],
    "every cell before the cursor is left exactly as it was",
  );
  assertDeepEqual(
    cellsAt(written, arm, 3, 3),
    ["drop", "rotate-ccw", "rotate-ccw"],
    "the cell that stood at the cursor holds the expansion's first instruction",
  );
  assertDeepEqual(
    cellsAt(written, arm, 6, 2),
    ["recede", null],
    "and the cell past the expansion's last stands where it stood: the three " +
      "cells were written over the tape rather than pushed into it",
  );
});
