// ruleset/r5-emitter-capacity — R5: an emitter carries at most one segment,
// so an emitter is never passed through or re-entered.
//
// THE POSE. `R5_EMITTER`:
//
//   Tt
//   Tt
//
// The beam T(0,0)–t(1,0)–t(1,1) hangs one segment on the emitter at (0,0).
// Both faces of the limit are then attempted:
//
//   1. RE-ENTERED: from the live end t(1,1), the move ONTO T(0,0) would hang a
//      second segment on it. Refused.
//   2. PASSED THROUGH: the trace resumed FROM the T(0,0) end (a press on
//      either end of a beam resumes it there — specs/controls.md), the move
//      out to t(1,1) would carry the beam through the emitter. Refused.
//
// Each refused segment is fresh and diagonal in an unused 2x2 block, the lens
// it involves has capacity to spare, and the channel is the beam's own — the
// emitter's capacity is the only rule in play (specs/beams.md R5).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R5_EMITTER } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";
import { moveOver, pressAt } from "./drive";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("refuses a second segment onto an emitter already carrying its one", async () => {
  const board = await loadBoard(h, R5_EMITTER);

  // One segment on the emitter at (0, 0), live end two lenses later.
  await pressAt(h, board, { col: 0, row: 0 });
  await moveOver(h, board, { col: 1, row: 0 });
  await moveOver(h, board, { col: 1, row: 1 });
  const beforeOnto = await h.snapshot();
  assertDeepEqual(
    beforeOnto.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 1, row: 1 },
    ],
    "the beam hangs its one segment on the emitter before the refused moves",
  );

  // Re-entering: a second segment ONTO the emitter.
  await moveOver(h, board, { col: 0, row: 0 });
  const afterOnto = await h.snapshot();
  await h.debug.pointerUp();

  // Passing through: resume from the emitter end and try to move OUT of it.
  await pressAt(h, board, { col: 0, row: 0 });
  const beforeOut = await h.snapshot();
  assertDeepEqual(
    beforeOut.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "the press on the emitter end resumes the beam there",
  );
  await moveOver(h, board, { col: 1, row: 1 });
  const afterOut = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "refused");
  await h.debug.pointerUp();

  assertDeepEqual(
    afterOnto.beams,
    beforeOnto.beams,
    "the beam is unchanged by the second segment onto the emitter",
  );
  assertDeepEqual(
    afterOnto.tracing,
    beforeOnto.tracing,
    "the trace stays live through the refused re-entry",
  );
  assertDeepEqual(
    afterOut.beams,
    beforeOut.beams,
    "the beam is unchanged by the move that would pass through the emitter",
  );
  assertDeepEqual(
    afterOut.tracing,
    beforeOut.tracing,
    "the trace stays live through the refused pass-through",
  );
});
