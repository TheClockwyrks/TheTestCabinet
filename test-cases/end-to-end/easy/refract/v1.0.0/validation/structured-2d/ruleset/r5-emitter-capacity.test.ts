// Refract — ruleset/r5-emitter-capacity: an emitter carries one segment.
//
// specs/beams.md R5: "An emitter carries at most one segment", and R6 adds
// that an emitter "is an end of the beam and never a pass-through". On
// R5_EMITTER the beam T(0,0)-t(1,0) is released and resumed from its T(0,0)
// end — the resume reverses the drawn order so the emitter is the live end
// (specs/controls.md "The drawn order and shortening") — and the extension
// toward t(1,1) would hang a second segment on that emitter. Nothing else on
// the board refuses the move (the diagonal's block carries no diagonal, the
// segment is fresh, the target lens is empty), so the refusal is R5's, and per
// the enforcement table it leaves the beam unchanged and the trace live.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R5_EMITTER } from "../fixtures";
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

it("a second segment onto a loaded emitter is refused", async () => {
  await resetTo(h);
  await loadBoard(h, R5_EMITTER);

  // Draw T(0,0)-t(1,0) and release: the emitter now carries its one segment.
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);

  // Resume from the emitter end: the beam is reoriented so T(0,0) is last.
  pressCell(h, { col: 0, row: 0 });
  const resumed = [
    { col: 1, row: 0 },
    { col: 0, row: 0 },
  ];
  const begun = h.snapshot();
  assertDeepEqual(
    begun.beams.triangle?.cells,
    resumed,
    "the resume reverses the beam so the emitter is the live end",
  );
  assertDeepEqual(
    begun.tracing?.live,
    { col: 0, row: 0 },
    "the trace resumes from the emitter",
  );

  // Extending from the loaded emitter to t(1,1) would be its second segment:
  // refused, so an emitter is never passed through or re-entered.
  moveToCell(h, { col: 1, row: 1 });
  const after = h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    resumed,
    "the emitter refuses a second segment",
  );
  assertNotNull(after.tracing, "the refusal leaves the trace live");

  // Evidence: the emitter refusing a second segment.
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "refused");
});
