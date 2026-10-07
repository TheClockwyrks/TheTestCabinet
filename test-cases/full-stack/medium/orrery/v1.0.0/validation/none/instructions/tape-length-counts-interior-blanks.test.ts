// instructions/tape-length-counts-interior-blanks — a blank between two
// instructions is a cell of the tape.
//
// THE RULE. "A tape's length is the index of its last non-blank cell plus one"
// (`specs/instructions.md`, Tapes and the period) — the INDEX of the last
// instruction, never a count of the instructions written. `specs/editor.md` says
// where the interior blanks come from: "A tape has no fixed end: writing past the
// last cell lengthens it, and the cells between hold blanks", which
// `specs/instrumentation.md` restates for the operation: "Cells between the
// tape's end and `col` become blanks."
//
// THE CONFIGURATION. One arm, on an otherwise empty machine, written twice:
// `grab` into column `0`, then `drop` into column `2`. Column `1` was never
// written, so it is the blank the second write left behind, and the last
// non-blank cell is at index `2`. Nothing runs; the machine's period is reported
// while editing, and with one taped part on the machine it IS that tape's length.
//
// THE VERDICT. The tape is three cells — `grab`, a blank, `drop` — and the
// machine's period is `3`, not the `2` a count of the instructions written would
// give.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { BARE, ORIGIN } from "../fixtures";
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

it("counts the blank between grab and drop, giving a tape of length 3", async () => {
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", ORIGIN);
  await h.debug.setTapeCell(arm, 0, "grab");
  await h.debug.setTapeCell(arm, 2, "drop");

  await h.advance(1);
  await captureStill(h, "interior-blank");

  const snapshot = await h.snapshot();
  const measured = partById(snapshot, arm);
  assertNotNull(
    measured,
    "the arm is still on the machine after its tape was written",
  );
  assertDeepEqual(
    measured?.tape,
    ["grab", null, "drop"],
    "the cell between the tape's end and the column written holds a blank",
  );
  assertEqual(
    snapshot.editor.period,
    3,
    "the length is the index of the last non-blank cell plus one, rather than a count of the instructions written",
  );
});
