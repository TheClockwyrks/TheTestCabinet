// Refract — ruleset/spent-crystal-refused: a fully spent crystal refuses entry.
//
// specs/beams.md R5: "The charge is spent on entry and the crossing is
// completed by leaving, so a beam enters a crystal only while that crystal has
// an unspent charge, and a move into a crystal whose charges are all spent is
// refused." On R5_SPENT_CRYSTAL the triangle beam enters the 1-charge crystal
// and is released there — the crossing begun and not yet left — so the charge
// is already spent, and the square beam's move into the crystal is refused
// even though no beam has left it. Nothing else refuses that move (the crystal
// is channel-neutral, the segment is fresh, its diagonal block carries no
// diagonal), and per the enforcement table the refusal leaves the beam
// unchanged and the trace live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import { R5_SPENT_CRYSTAL } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  moveToCell,
  pressCell,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a crystal entered and not yet left refuses a second entry", async () => {
  await resetTo(h);
  await loadBoard(h, R5_SPENT_CRYSTAL);

  // The triangle beam enters the crystal and is left there: the 1 charge is
  // spent on entry, the crossing not yet completed by leaving.
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  const entered = h.snapshot();
  const crystal = entered.board.nodes.find((node) => node.kind === "crystal");
  assertEqual(crystal?.spent, 1, "the charge is spent on entry");
  assertEqual(
    entered.solved,
    false,
    "the begun crossing leaves the board unsolved",
  );

  // The square beam attempts the same crystal: every charge is spent, so the
  // entry is refused.
  pressCell(h, { col: 0, row: 1 });
  assertDeepEqual(
    h.snapshot().beams.square?.cells,
    [{ col: 0, row: 1 }],
    "the square beam starts at its emitter",
  );
  moveToCell(h, { col: 1, row: 0 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.square?.cells,
    [{ col: 0, row: 1 }],
    "the spent crystal refuses the second entry",
  );
  assertDeepEqual(
    after.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the beam holding the begun crossing is untouched",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");

  // Evidence: the spent crystal refusing a second entry.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});
