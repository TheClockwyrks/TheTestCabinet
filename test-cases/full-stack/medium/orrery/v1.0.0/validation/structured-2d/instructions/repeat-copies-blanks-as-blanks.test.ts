// instructions/repeat-copies-blanks-as-blanks — a blank in the prefix is written
// as a blank at the matching offset.
//
// THE RULE. "Invoked at a cell, `repeat` copies the arm's own cells from index `0`
// up to but not including that cell, blanks included, and writes the copy from
// that cell onward" (`specs/instructions.md`, `repeat`). "Blanks included" is what
// this item decides. `specs/instructions.md` also fixes what a blank cell IS
// rather than leaving it as an absence: "A tape cell holds one of them or is
// blank", and "A blank cell is a rest: the part holds its pose for the cycle".
// The copy is therefore the prefix cell for cell — one cell per entry, from the
// cursor onward (The two macros) — rather than the prefix's instructions closed up.
//
// THE CONFIGURATION. One arm at the origin at rotation `0` and length `1`, on no
// track, carrying three cells: `grab`, a BLANK, and `drop`. The cursor is pointed
// at column `3`, so the prefix is all three and the copy lands on columns `3`, `4`
// and `5`. The blank sits in the MIDDLE of the prefix, which is what makes the two
// readings separable: copied cell for cell, `drop` lands at column `5`; closed up,
// it lands at column `4` and column `5` is left blank instead.
//
// THE BLANK SURVIVES THE READING BECAUSE IT IS NOT A TRAILING ONE. `specs/formats.md`
// requires a tape's "last entry" to be "an instruction", so a blank at the end of a
// tape is not a cell at all; this one is followed by `drop` on both sides of the
// cursor and is a cell of the tape either way.
//
// THE VERDICT. Column `3` holds `grab`, column `4` is blank, column `5` holds
// `drop`, and column `6` is blank because the copy was three cells long.

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

/** A blank between two instructions: a cell of the tape, not the tape's end. */
const TAPE: readonly (InstructionName | null)[] = ["grab", null, "drop"];

it("writes the prefix's blank as a blank, at the matching offset", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertNotNull(
    partById(before, arm)?.tape,
    "the arm carries a tape for the macro to read",
  );
  assertDeepEqual(
    cellsAt(before, arm, 0, 3),
    ["grab", null, "drop"],
    "the prefix stands with a blank between its two instructions",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 3);
  await pressAction(h, "ins-repeat");
  await captureStill(h, "blank-kept");

  const written = await h.snapshot();
  assertDeepEqual(
    cellsAt(written, arm, 3, 3),
    ["grab", null, "drop"],
    "the copy is the prefix cell for cell: the blank is written as a blank at " +
      "the matching offset rather than closed up",
  );
  assertDeepEqual(
    cellsAt(written, arm, 6, 1),
    [null],
    "and the copy is three cells long, as the prefix is",
  );
});
