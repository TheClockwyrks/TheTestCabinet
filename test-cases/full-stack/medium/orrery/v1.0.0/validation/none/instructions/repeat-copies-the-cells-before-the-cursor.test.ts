// instructions/repeat-copies-the-cells-before-the-cursor — the copy is cells `0`
// up to but not including the cursor's own column.
//
// THE RULE. "Invoked at a cell, `repeat` copies the arm's own cells from index `0`
// up to but not including that cell, blanks included, and writes the copy from
// that cell onward" (`specs/instructions.md`, `repeat`). Two things follow, and
// this item decides both: WHICH cells are read — the prefix, with the cursor's own
// cell left out — and in WHAT ORDER they are written, "one cell per entry of the
// expansion" from the cursor onward (The two macros).
//
// THE CONFIGURATION. One arm at the origin at rotation `0` and length `1`, on no
// track, carrying four cells: `grab`, `rotate-cw`, `pivot-cw`, `drop`. The cursor
// is pointed at column `3`. The three cells before it are all different, so the
// order they are written back in is readable rather than a coincidence, and the
// cell AT the cursor is a fourth name — `drop` — that appears nowhere in the
// prefix. A build that read cells `0` through `3` inclusive would write four
// cells, ending with `drop` at column `6`; a build that read the suffix, or the
// prefix reversed, writes different names in the same three columns.
//
// THE ARM IS AT ITS REST POSE AND ON NO TRACK because `repeat` is not computed
// from a pose at all: it reads the tape, and the arm's pose is beside the point.
//
// THE VERDICT. Columns `3`, `4` and `5` hold `grab`, `rotate-cw` and `pivot-cw` in
// that order, and column `6` is blank — three cells were copied, not four.

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

it("writes cells 0, 1 and 2 into columns 3, 4 and 5, leaving the cursor's own cell out", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", 0, 0, 0, 1, ["grab", "rotate-cw", "pivot-cw", "drop"]),
    ]),
  );
  const arm = (await partIds(h))[0] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 3);
  await pressAction(h, "ins-repeat");
  await captureStill(h, "copied");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the arm still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, arm, 3, 3),
    ["grab", "rotate-cw", "pivot-cw"],
    "the tape's cells 0, 1 and 2 are written into columns 3, 4 and 5 in that order",
  );
  assertDeepEqual(
    cellsAt(written, arm, 6, 1),
    [null],
    "and column 6 is blank: the cell that stood at the cursor's own column was " +
      "not among what the copy read",
  );
});
