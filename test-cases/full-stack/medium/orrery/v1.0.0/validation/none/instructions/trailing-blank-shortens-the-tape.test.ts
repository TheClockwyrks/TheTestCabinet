// instructions/trailing-blank-shortens-the-tape — blanking the last instruction
// ends the tape at the one before it.
//
// THE RULE. "A tape's length is the index of its last non-blank cell plus one"
// (`specs/instructions.md`, Tapes and the period), so which cell is last is
// re-decided by every write: blank the last instruction and the last non-blank
// cell becomes the one before it. `specs/instrumentation.md` states that the
// operation re-applies it: "`setTapeCell(part, col, instruction)` — Writes
// `instruction` ... or `null` for a blank ... and the trimming rule of
// `specs/formats.md` is applied afterwards", and that rule is "Its last entry is
// an instruction, and an entirely blank tape is the empty list."
//
// THE CONFIGURATION. One arm, on an otherwise empty machine, whose tape is
// written as `grab`, `drop`, `grab` — length `3`, read back as the machine's
// period because it is the machine's only tape. Then cell `2`, its last
// instruction, is blanked. Nothing runs.
//
// THE VERDICT. The tape is `grab`, `drop` — the two cells up to the non-blank one
// before the blanked cell — and the machine's period is `2`.

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

it("ends the tape at the instruction before the cell that was blanked", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await writeTape(h, arm, ["grab", "drop", "grab"]);

  const before = await h.snapshot();

  await h.debug.setTapeCell(arm, 2, null);

  await h.advance(1);
  await captureStill(h, "shortened");

  assertDeepEqual(
    partById(before, arm)?.tape,
    ["grab", "drop", "grab"],
    "the tape holds the three instructions written into columns 0 to 2",
  );
  assertEqual(
    before.editor.period,
    3,
    "a tape whose last non-blank cell is at index 2 has length 3",
  );

  const after = await h.snapshot();
  const measured = partById(after, arm);
  assertNotNull(
    measured,
    "the arm is still on the machine after the cell was blanked",
  );
  assertDeepEqual(
    measured?.tape,
    ["grab", "drop"],
    "blanking the last non-blank cell leaves the tape ending at the non-blank cell before it",
  );
  assertEqual(
    after.editor.period,
    2,
    "a tape of grab, drop, grab whose cell 2 is blanked has length 2",
  );
});
