// instrumentation/set-tape-cell-fills-the-gap — a write past the tape's end fills
// the gap with blanks.
//
// THE RULE. "`setTapeCell(part, col, instruction)` | Writes `instruction`... at
// column `col` of that part's tape, a whole number of at least `0`. Cells between
// the tape's end and `col` become blanks, and the trimming rule of
// `specs/formats.md` is applied afterwards" (`specs/instrumentation.md`, The
// machine). `specs/editor.md` states the same for a write made by hand: "A tape
// has no fixed end: writing past the last cell lengthens it, and the cells between
// hold blanks." The trimming rule keeps the tape exactly this long and no longer:
// "Its last entry is an instruction, and an entirely blank tape is the empty list"
// (`specs/formats.md`, Solutions).
//
// THE CONFIGURATION. One arm at `(0, 0)`, placed "at length `ARM_MIN_LEN` (`1`)
// with an empty tape" as `placePart` places every part, and one write: `grab` at
// column `5`. There is nothing before column `5` to keep, so the whole gap is the
// tape. Nothing else is placed, and no run is started, because the requirement is
// about what the tape holds.
//
// THE VERDICT. The tape the machine reports holds six entries: five blanks and
// then `grab` at column `5`. Not five, not seven, and not a tape that dropped the
// blanks it was told to leave.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
} from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every cell between the tape's old end and the written column blank", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", at(0, 0), 0);
  const empty = await h.snapshot();

  await h.debug.setTapeCell(arm, 5, "grab");
  await h.advance(1);
  await captureStill(h, "filled");
  const filled = await h.snapshot();

  assertDeepEqual(
    partById(empty, arm)?.tape,
    [],
    "placePart places the arm with an empty tape, so the write is past its end",
  );
  assertNotNull(
    partById(filled, arm),
    "the machine still reports the arm the write was made on",
  );
  assertLength(
    partById(filled, arm)?.tape ?? [],
    6,
    "a write at column 5 of an empty tape gives a tape of six entries",
  );
  assertDeepEqual(
    partById(filled, arm)?.tape,
    [null, null, null, null, null, "grab"],
    "the first five entries are blank and the written instruction stands at column 5",
  );
  assertEqual(
    filled.editor.period,
    6,
    "the tape's length is six, so the machine's period is six",
  );
});
