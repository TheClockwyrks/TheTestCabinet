// Refract — ruleset/r4-diagonal-exclusivity: R4 Diagonal exclusivity.
//
// specs/beams.md R4: "The two diagonals of any 2x2 block of cells are mutually
// exclusive: at most one of the two is ever part of a beam." R4_CROSS_2X2 is a
// 2x2 board whose two diagonals belong to different channels, so whichever
// diagonal is drawn first, the crossing one is refused — attempted here in
// both orders, on a fresh board each time. The crossing move breaks R4 alone:
// its segment is unused, its target is the mover's own fresh emitter, and per
// the enforcement table the refusal leaves the beam unchanged and the trace
// live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R4_CROSS_2X2 } from "../fixtures";
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

it("the square diagonal drawn first refuses the triangle diagonal", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R4_CROSS_2X2);

  // Square draws its diagonal, S(1,0)-S(0,1).
  traceCells(h, [
    { col: 1, row: 0 },
    { col: 0, row: 1 },
  ]);
  assertDeepEqual(
    h.snapshot().beams.square?.cells,
    [
      { col: 1, row: 0 },
      { col: 0, row: 1 },
    ],
    "the square diagonal is drawn",
  );

  // Triangle attempts the crossing diagonal, T(0,0) -> T(1,1): refused.
  pressCell(h, { col: 0, row: 0 });
  moveToCell(h, { col: 1, row: 1 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the crossing diagonal is refused",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");

  // Evidence: the crossing diagonal refused.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});

it("the triangle diagonal drawn first refuses the square diagonal", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R4_CROSS_2X2);

  // The other order: triangle draws its diagonal first.
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "the triangle diagonal is drawn",
  );

  pressCell(h, { col: 1, row: 0 });
  moveToCell(h, { col: 0, row: 1 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.square?.cells,
    [{ col: 1, row: 0 }],
    "the crossing diagonal is refused, whichever order the two are attempted in",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");
  h.debug.pointerUp();
});
