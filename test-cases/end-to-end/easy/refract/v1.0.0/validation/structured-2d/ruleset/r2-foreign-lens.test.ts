// Refract — ruleset/r2-foreign-lens: R2 Exclusion at a foreign lens.
//
// specs/beams.md R2: "A beam never meets an emitter or a lens of another
// channel." On R2_FOREIGN the square beam S(0,2)-s(1,1) is extended toward the
// triangle lens t(1,0): the move is refused, and per the enforcement table the
// refusal leaves the beam unchanged and the trace live. The target carries no
// segments, so R2 is the one rule the move breaks.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R2_FOREIGN } from "../fixtures";
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

it("a move onto another channel's lens is refused", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R2_FOREIGN);

  // The square beam, drawn to its own lens: S(0,2) -> s(1,1).
  pressCell(h, { col: 0, row: 2 });
  moveToCell(h, { col: 1, row: 1 });
  const drawn = [
    { col: 0, row: 2 },
    { col: 1, row: 1 },
  ];
  assertDeepEqual(
    h.snapshot().beams.square?.cells,
    drawn,
    "the square beam reaches its own lens",
  );

  // Onto the TRIANGLE lens t(1,0): another channel's lens, refused.
  moveToCell(h, { col: 1, row: 0 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.square?.cells,
    drawn,
    "the move onto another channel's lens is refused",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");

  // Evidence: the beam unchanged at the other channel's lens.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});
