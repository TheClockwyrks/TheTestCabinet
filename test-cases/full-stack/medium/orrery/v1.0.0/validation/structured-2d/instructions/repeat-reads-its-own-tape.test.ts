// instructions/repeat-reads-its-own-tape — the copy is the cursor's own row, and
// what the rest of the machine carries changes nothing.
//
// THE RULE. "Both are computed from the arm's own tape alone"
// (`specs/instructions.md`, The two macros), and `repeat` itself is defined over
// that one tape: "Invoked at a cell, `repeat` copies the arm's own cells from
// index `0` up to but not including that cell". `specs/editor.md` adds what an
// edit reaches: "An edit changes the edited part alone."
//
// THE MACHINE CARRIES THREE ROWS ON PURPOSE. The panel "shows one row per arm and
// wheel, in placement order" (`specs/editor.md`), and here that is an arm at the
// origin, a second arm to its east, and a wheel to its south. The cursor is
// pointed at the FIRST row, whose tape is `grab`, `drop`; the other two carry
// longer tapes of names the first does not hold at all — rotations and pivots.
// So a build that read the machine's tapes together, or read the selected part's
// row, or read the longest row, writes cells the first row never held.
//
// WHAT IS READ BACK IS BOTH HALVES OF "ITS OWN TAPE ALONE". The copy is the
// cursor's row's own two cells, in its own order; and the other two rows stand
// exactly as they were, because the macro is an edit of the row it was invoked on.
//
// THE VERDICT. Columns `2` and `3` of the first row hold `grab` and `drop`, column
// `4` is blank, and the second arm's and the wheel's tapes are untouched.

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

/** The cursor's row: two cells, and neither name appears on another row. */
const OWN: readonly InstructionName[] = ["grab", "drop"];

/** The second arm's row: longer, and made of names the cursor's row never holds. */
const OTHER_ARM: readonly InstructionName[] = [
  "rotate-cw",
  "rotate-ccw",
  "pivot-cw",
  "pivot-ccw",
];

/** The wheel's row: longer still, and a wheel's own two instructions. */
const WHEEL: readonly InstructionName[] = [
  "rotate-ccw",
  "rotate-ccw",
  "rotate-ccw",
  "rotate-ccw",
  "rotate-ccw",
];

it("copies the cursor's own row, whatever the other rows carry", async () => {
  await openChallengeDocument(h, BARE);
  await loadMachine(
    h,
    solution([
      armPart("arm", 0, 0, 0, 1, OWN),
      armPart("arm", 3, 0, 0, 1, OTHER_ARM),
      armPart("wheel", 0, 3, 0, 1, WHEEL),
    ]),
  );
  const ids = await partIds(h);
  const arm = ids[0] ?? -1;
  const other = ids[1] ?? -1;
  const wheel = ids[2] ?? -1;

  await h.debug.setFocus("tape");
  await h.debug.setCursor(arm, 2);
  await pressAction(h, "ins-repeat");
  await captureStill(h, "own-tape");

  const written = await h.snapshot();
  assertNotNull(
    partById(written, arm)?.tape,
    "the cursor's arm still carries a tape to have been written to",
  );
  assertDeepEqual(
    cellsAt(written, arm, 2, 3),
    ["grab", "drop", null],
    "the copy is the cursor's own row's two cells, in its own order, and " +
      "nothing from the longer rows beside it",
  );
  assertNotNull(
    partById(written, other)?.tape,
    "the second arm still carries a tape",
  );
  assertDeepEqual(
    cellsAt(written, other, 0, 6),
    [...OTHER_ARM, null, null],
    "the second arm's tape is untouched: an edit changes the edited part alone",
  );
  assertNotNull(
    partById(written, wheel)?.tape,
    "the wheel still carries a tape",
  );
  assertDeepEqual(
    cellsAt(written, wheel, 0, 6),
    [...WHEEL, null],
    "and so is the wheel's",
  );
});
