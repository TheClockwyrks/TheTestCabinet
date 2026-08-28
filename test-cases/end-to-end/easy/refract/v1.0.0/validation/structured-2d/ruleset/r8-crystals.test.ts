// Refract — ruleset/r8-crystals: R8 Crystals.
//
// specs/beams.md R8: "A crystal is satisfied when all of its charges are
// spent and every crossing begun across it has been completed. A beam that
// ends on a crystal has begun a crossing it has not completed, and leaves
// that crystal unsatisfied." On SHARED_CRYSTAL the triangle beam crosses the
// 2-charge crystal completely and is complete; the square beam is left ending
// on the crystal, spending its second charge without completing the crossing.
// Every charge is therefore spent — R8's charge clause is met and only the
// begun-uncompleted crossing holds the board unsolved. (A beam ending on a
// crystal cannot itself report complete — R6 requires its ends at emitters —
// so the completeness that IS met, the triangle beam's, is what the check
// holds beside solved false.) Extending the square beam out of the crystal to
// its far emitter completes the crossing, satisfies the crystal, and flips
// solved true on that move (R9).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { SHARED_CRYSTAL } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a begun, uncompleted crossing holds the board unsolved until it is completed", async () => {
  await resetTo(h, 1);
  await loadBoard(h, SHARED_CRYSTAL);

  // Triangle crosses the crystal completely: in at T(0,0), out to T(2,0).
  h.debug.trace([
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
  ]);
  assertEqual(
    h.snapshot().beams.triangle?.complete,
    true,
    "the triangle beam crossing the crystal is complete",
  );

  // Square is left ending on the crystal: its charge is spent on entry, the
  // crossing begun and not completed.
  pressCell(h, { col: 0, row: 1 });
  moveToCell(h, { col: 1, row: 0 });
  h.debug.pointerUp();

  const pending = h.snapshot();
  const crystal = pending.board.nodes.find((node) => node.kind === "crystal");
  assertEqual(crystal?.spent, 2, "all of the crystal's charges are spent");
  assertDeepEqual(
    pending.beams.square?.cells,
    [
      { col: 0, row: 1 },
      { col: 1, row: 0 },
    ],
    "the square beam is left ending on the crystal",
  );
  assertEqual(
    pending.solved,
    false,
    "the begun, uncompleted crossing leaves the crystal unsatisfied and the board unsolved",
  );
  assertEqual(pending.screen, "playing", "the unsolved board plays on");

  // Evidence: the crystal holding the board unsolved.
  await h.advance(1);
  captureStill(h, "unsatisfied");

  // Completing the crossing — resuming from the beam's crystal end and
  // leaving to the far emitter — satisfies the crystal and flips solved true.
  pressCell(h, { col: 1, row: 0 });
  moveToCell(h, { col: 2, row: 1 });
  const done = h.snapshot();
  assertEqual(done.solved, true, "completing the crossing flips solved true");
  h.debug.pointerUp();
});
