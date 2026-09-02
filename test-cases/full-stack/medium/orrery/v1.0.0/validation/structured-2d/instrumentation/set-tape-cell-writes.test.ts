// instrumentation/set-tape-cell-writes — `setTapeCell` writes an instruction at a
// column, and the cycle that reads that column executes it.
//
// THE RULE. "`setTapeCell(part, col, instruction)` | Writes `instruction`, a name
// from `INSTRUCTIONS` in `specs/instructions.md` or `null` for a blank, at column
// `col` of that part's tape, a whole number of at least `0`"
// (`specs/instrumentation.md`, The machine). The tape IS the tape panel's row —
// "The panel shows one row per arm and wheel, in placement order... Visible column
// `u`... shows cell `firstCol + u`" (`specs/editor.md`) — and the snapshot reports
// it as "`tape: [<instruction | null>] | null`". Which cycle reads which column is
// `specs/instructions.md`'s: "The machine's period `P` is the largest tape length
// across its arms and wheels... On cycle `c`, counted from `0`, each part executes
// the cell at index `c` modulo `P` of its own tape", and `setCycle(n)` "Sets
// `sim.cycle` to `n`... so the next cycle executes tape cell `n mod P` on every
// part". `rotate-cw` is "The part turns one 60 degree step clockwise about its
// base" (`specs/instructions.md`).
//
// THE CONFIGURATION. One arm at `(0, 0)`, placed at rotation `0` "with an empty
// tape", and one write: `rotate-cw` at column `2`. That makes the tape three cells
// long and the machine's period `3`. The run is then set to cycle `5`, whose
// column is `5 mod 3` — column `2`, the one written — so a build that executed the
// column it was handed rather than the column the cycle names would rest. Nothing
// else is placed and the field is emptied, so nothing else can turn the arm.
//
// THE VERDICT. The arm's tape is a blank, a blank, and `rotate-cw` at column `2`,
// and the machine's period is `3`; and the cycle at column `2` turns the arm one
// step clockwise, from rotation `0` to rotation `1`.

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
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("writes an instruction at a column the cycle at that column then executes", async () => {
  await h.debug.reset();
  await openChallengeDocument(h, BARE);
  const arm = await placePart(h, "arm", at(0, 0), 0);

  await h.debug.setTapeCell(arm, 2, "rotate-cw");
  const written = await h.snapshot();

  await h.debug.setCompletion(false);
  await h.debug.startRun();
  await h.debug.clearMotes();
  await h.debug.setCycle(5);
  const before = await h.snapshot();

  await advanceCycles(h, 1);
  await h.advance(1);
  await captureStill(h, "written");
  const after = await h.snapshot();

  assertNotNull(
    partById(written, arm),
    "the machine still reports the arm the write was made on",
  );
  assertDeepEqual(
    partById(written, arm)?.tape,
    [null, null, "rotate-cw"],
    "the instruction stands at column 2, with blanks before it",
  );
  assertEqual(
    written.editor.period,
    3,
    "the machine's period is the written tape's length",
  );
  assertEqual(
    poseOf(before, arm)?.rotation,
    0,
    "the arm is at its rest rotation before the cycle runs",
  );
  assertEqual(
    after.sim?.status,
    "running",
    "the cycle runs to its boundary rather than faulting",
  );
  assertEqual(
    poseOf(after, arm)?.rotation,
    1,
    "cycle 5 executes column 5 mod 3, which is the column written, so the arm turns one step clockwise",
  );
});
