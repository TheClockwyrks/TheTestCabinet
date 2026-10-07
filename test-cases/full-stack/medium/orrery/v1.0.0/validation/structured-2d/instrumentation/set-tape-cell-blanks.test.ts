// instrumentation/set-tape-cell-blanks — `setTapeCell` with `null` blanks a
// column, and the part rests on the cycle that reads it.
//
// THE RULE. "`setTapeCell(part, col, instruction)` | Writes `instruction`, a name
// from `INSTRUCTIONS` in `specs/instructions.md` or `null` for a blank, at column
// `col` of that part's tape" (`specs/instrumentation.md`, The machine). What a
// blank cell means is `specs/instructions.md`'s: "A blank cell is a rest: the part
// holds its pose for the cycle, keeping whatever grip it has", and
// `specs/simulation.md` says the same of the fetch — "A blank cell is a rest on
// every part, a wheel included, and never faults". Which cycle reads which column
// is "the cell at index `c` modulo `P` of its own tape, blank cells included"
// (`specs/instructions.md`), and `setCycle(n)` sets the cycle the next one runs at.
//
// THE CONFIGURATION. One arm at `(0, 0)` at rotation `0` carrying three
// `rotate-cw` cells, so every column would turn it and the period is `3`; then one
// blank written into column `1`. The blank is a MIDDLE column on purpose: the
// trimming rule of `specs/formats.md` — "Its last entry is an instruction" — would
// shorten a tape blanked at its end, and this check is about the rest rather than
// about the trim. The run is then set to cycle `1`, whose column is `1 mod 3`, the
// blanked one. Nothing else is placed and the field is emptied.
//
// THE VERDICT. Column `1` is blank and the columns either side still hold their
// instruction, so the tape is `rotate-cw`, a blank, `rotate-cw` and the period is
// still `3`; and the cycle that reads column `1` completes with the arm on exactly
// the rotation it began the cycle at.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { at } from "../field";
import { BARE } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openChallengeDocument,
  partById,
  placePart,
  poseOf,
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

it("blanks a column, so the part rests on the cycle that reads it", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", at(0, 0), 0);
  await writeTape(h, arm, ["rotate-cw", "rotate-cw", "rotate-cw"]);

  await h.debug.setTapeCell(arm, 1, null);
  const blanked = await h.snapshot();

  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  await h.debug.setCycle(1);
  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "blanked");
  const after = await h.snapshot();

  assertNotNull(
    partById(blanked, arm),
    "the machine still reports the arm the blank was written on",
  );
  assertDeepEqual(
    partById(blanked, arm)?.tape,
    ["rotate-cw", null, "rotate-cw"],
    "column 1 is blank and the columns either side keep their instruction",
  );
  assertEqual(
    blanked.editor.period,
    3,
    "the tape still ends on an instruction, so the period is unchanged",
  );
  assertEqual(
    poseOf(before, arm)?.rotation,
    0,
    "the arm is at its rest rotation as the cycle at column 1 begins",
  );
  assertEqual(
    after.sim?.status,
    "running",
    "a blank cell never faults, so the cycle reaches its boundary",
  );
  assertEqual(
    after.sim?.cycle,
    2,
    "the cycle at column 1 completed, so the counter moved past it",
  );
  assertEqual(
    poseOf(after, arm)?.rotation,
    0,
    "the arm held its pose for the cycle: the blank column is a rest",
  );
});
