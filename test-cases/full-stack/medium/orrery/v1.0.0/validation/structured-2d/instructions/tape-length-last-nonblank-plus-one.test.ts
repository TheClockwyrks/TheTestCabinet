// instructions/tape-length-last-nonblank-plus-one — a tape ends at its last
// instruction, and blanks after it add nothing.
//
// THE RULE. "A tape's length is the index of its last non-blank cell plus one,
// and `0` when it is entirely blank" (`specs/instructions.md`, Tapes and the
// period). `specs/state.md` says the same of the reading: "`tape` — the tape,
// for arms and wheels ... Its length is trimmed: the last entry is never `null`",
// and the machine's period is derived from it — "The machine's period `P` is the
// largest tape length across its arms and wheels" — so with one taped part on
// the machine `editor.period` IS that tape's length.
//
// THE CONFIGURATION. One arm, on an otherwise empty machine, with three
// instructions written into columns `0`, `1` and `2` — so its last non-blank cell
// is at index `2` — and then a blank written into each of columns `3`, `4` and
// `5`. Writing a blank is a write like any other: "`setTapeCell(part, col,
// instruction)` — Writes `instruction`, a name from `INSTRUCTIONS` ... or `null`
// for a blank, at column `col` of that part's tape ... Cells between the tape's
// end and `col` become blanks, and the trimming rule of `specs/formats.md` is
// applied afterwards" (`specs/instrumentation.md`). So the three blanks are cells
// the editor was asked for beyond the last instruction, which is exactly the
// "whatever blanks follow it" the rule is about.
//
// Nothing runs. The requirement is a fact about a tape, and the machine's period
// is reported while editing.
//
// THE VERDICT. The tape is those three instructions and no more, and the
// machine's period is `3` rather than `4`, `6`, or anything counting the blanks
// that were asked for after it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { BARE, ORIGIN } from "../fixtures";
import {
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  writeTape,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("measures a tape to its last non-blank cell, whatever blanks were written after it", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await writeTape(h, arm, ["grab", "rotate-cw", "drop"]);

  const written = await h.snapshot();

  for (const column of [3, 4, 5]) {
    await h.debug.setTapeCell(arm, column, null);
  }

  await h.advance(1);
  await captureStill(h, "length");

  assertEqual(
    written.editor.period,
    3,
    "three instructions in columns 0 to 2 make a tape of length 3, which is the machine's only tape",
  );

  const snapshot = await h.snapshot();
  const measured = partById(snapshot, arm);
  assertNotNull(
    measured,
    "the arm is still on the machine after the blanks were written",
  );
  assertDeepEqual(
    measured?.tape,
    ["grab", "rotate-cw", "drop"],
    "the tape ends at its last non-blank cell: the blanks written after it are not cells of it",
  );
  assertEqual(
    snapshot.editor.period,
    3,
    "a tape whose last non-blank cell is at index 2 has length 3, whatever blanks follow it",
  );
});
