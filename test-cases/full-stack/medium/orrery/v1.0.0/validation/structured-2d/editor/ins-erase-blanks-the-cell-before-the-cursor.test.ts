// editor/ins-erase-blanks-the-cell-before-the-cursor — `Backspace` empties the
// cell BEFORE the cursor, never the cell the cursor stands on.
//
// THE RULE. "`ins-erase` blanks the cell before the cursor and moves back one,
// and does nothing at column `0`" (`specs/editor.md`, The tape panel).
// `specs/controls.md` says the same of the key: "It blanks the cell before the
// cursor, as `specs/editor.md` states." What this item decides is which cell went
// blank; where the cursor came to rest is decided beside it.
//
// THE CONFIGURATION. One arm carrying four cells, all four different names, and
// the cursor at column `2` — a column above `0`, as the rule's "does nothing at
// column `0`" clause requires of everything else it says, and an interior one, so
// the erased cell has a cell either side of it.
//
// THE VERDICT. Column `1` is blank, column `2` still holds what it held, and
// columns `0` and `3` are untouched — so exactly one cell went blank, and it was
// the one before the cursor rather than the one under it.

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

/** Four cells, four different names, so the wrong cell going blank is visible. */
const TAPE: readonly InstructionName[] = [
  "grab",
  "drop",
  "rotate-cw",
  "pivot-cw",
];

it("blanks column 1 when the cursor stands at column 2", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertDeepEqual(
    cellsAt(before, arm, 0, 4),
    [...TAPE],
    "the arm stands with the four cells it was given",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 2);
  await pressAction(h, "ins-erase");
  await captureStill(h, "erased");

  const after = await h.snapshot();
  assertNotNull(
    partById(after, arm)?.tape,
    "the arm still carries a tape after the erase",
  );
  assertDeepEqual(
    cellsAt(after, arm, 0, 4),
    ["grab", null, "rotate-cw", "pivot-cw"],
    "ins-erase blanks the cell before the cursor and leaves the cursor's own cell as it stands",
  );
});
