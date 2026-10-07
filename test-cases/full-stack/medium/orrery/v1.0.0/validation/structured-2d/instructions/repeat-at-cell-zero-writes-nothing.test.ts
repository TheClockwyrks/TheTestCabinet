// instructions/repeat-at-cell-zero-writes-nothing — an empty copy leaves the tape
// as it stands.
//
// THE RULE. "Invoked at cell `0` the copy is empty, so it writes nothing"
// (`specs/instructions.md`, `repeat`) — there are no cells "from index `0` up to
// but not including" cell `0`. What an empty expansion does is stated once for
// both macros: "a macro whose expansion is empty leaves the whole tape as it
// stands" (The two macros).
//
// THE TAPE IS NOT EMPTY, which is the whole of the trap this item guards. A build
// that copied the cells from the cursor ONWARD, or that took an empty copy as a
// reason to clear the tape, or that wrote a single blank at the cursor, changes a
// tape that must not change; a build that reads the prefix correctly finds nothing
// to write and touches none of it. So the arm carries three instructions from
// column `0`, and the check reads every one of them back, along with the blank
// columns after them.
//
// THE CONFIGURATION. One arm at the origin at rotation `0` and length `1`, on no
// track, carrying `grab`, `rotate-cw`, `drop`, with the cursor pointed at column
// `0` and the focus on the tape.
//
// THE VERDICT. Every column of the tape holds what it held before the key was
// pressed.

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

/** Three instructions from column 0: a tape there is plenty to spoil. */
const TAPE: readonly InstructionName[] = ["grab", "rotate-cw", "drop"];

/** The tape as columns, so a blank column reads as a blank rather than as nothing. */
const COLUMNS: (InstructionName | null)[] = [...TAPE, null, null, null];

it("leaves every cell of the tape as it was", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(h, solution([armPart("arm", 0, 0, 0, 1, TAPE)]));
  const arm = (await partIds(h))[0] ?? -1;

  const before = await h.snapshot();
  assertNotNull(
    partById(before, arm)?.tape,
    "the arm carries a tape for the macro to leave alone",
  );
  assertDeepEqual(
    cellsAt(before, arm, 0, COLUMNS.length),
    COLUMNS,
    "the arm stands with the tape it was given",
  );

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 0);
  await pressAction(h, "ins-repeat");
  await captureStill(h, "no-op");

  const after = await h.snapshot();
  assertNotNull(
    partById(after, arm)?.tape,
    "the arm still carries a tape after the macro ran",
  );
  assertDeepEqual(
    cellsAt(after, arm, 0, COLUMNS.length),
    COLUMNS,
    "the copy at column 0 is empty, so the whole tape stands as it was",
  );
});
