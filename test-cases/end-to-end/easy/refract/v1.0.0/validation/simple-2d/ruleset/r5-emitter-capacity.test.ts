// ruleset/r5-emitter-capacity — R5: an emitter carries at most one segment.
//
// The board is the R5_EMITTER fixture, `Tt / Tt`. The triangle beam runs
// T(0,0)-t(1,0)-t(1,1) in one live trace, and both faces of the limit are
// probed against it:
//
//   1. RE-ENTERED: from the live end t(1,1), the move ONTO T(0,0) would hang a
//      second segment on the emitter. Refused.
//   2. PASSED THROUGH: with the trace resumed FROM the T(0,0) end (a press on
//      either end of a beam resumes it there — specs/controls.md), the move
//      out to t(1,1) would carry the beam THROUGH the emitter, which is that
//      same second segment. Refused.
//
// specs/beams.md R5 states the limit as a property of the node — "An emitter
// carries at most one segment" — and R6 states the second face outright: "An
// emitter is an end of the beam and never a pass-through." The item's own
// description covers both, "so an emitter is never passed through or
// re-entered", so both are asserted here.
//
// One requirement per validator would make these two items rather than one.
// They are one here because this version's item set is fixed; a future version
// splits the onto-an-emitter face from the pass-through face.
//
// Each probe is otherwise clean, so R5 is the only rule it breaks: T(0,0) is
// the channel's own emitter (R2 clear), the attempted segment is fresh (R3
// clear), its 2x2 block carries no diagonal yet (R4 clear), and neither target
// is the node behind the live end, so each is an extension attempt rather than
// a retract (specs/controls.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { R5_EMITTER } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { assertLiveTrace } from "./support";

/** R5_EMITTER is `Tt / Tt`: 2 columns, 2 rows. */
const COLS = 2;
const ROWS = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await resetTo(h, 1);
  await loadBoard(h, R5_EMITTER);
});

afterEach(() => {
  h?.dispose();
});

it("refuses a second segment onto a loaded emitter, and a move out of one", async () => {
  const at = (col: number, row: number) => nodeCenter(col, row, COLS, ROWS);

  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  h.debug.pointerMove(at(1, 0).x, at(1, 0).y);
  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const before = h.snapshot();
  assertDeepEqual(
    before.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 1, row: 1 },
    ],
    "the beam leaves its emitter carrying one segment and reaches t(1,1) " +
      "(specs/beams.md permits every segment of it)",
  );

  // Face 1 — the re-entry attempt: a second segment onto the emitter T(0,0).
  h.debug.pointerMove(at(0, 0).x, at(0, 0).y);
  const refused = h.snapshot();
  assertDeepEqual(
    refused.beams,
    before.beams,
    "R5: a second segment onto an emitter already carrying its one is " +
      "refused — the beam is unchanged, so an emitter is never re-entered " +
      "(specs/beams.md)",
  );
  assertLiveTrace(
    refused,
    "triangle",
    { col: 1, row: 1 },
    "the refused re-entry leaves the trace live",
  );

  // Evidence: the emitter refusing a second segment, mid-trace.
  await h.advance(1);
  captureStill(h, "refused");

  h.debug.pointerUp();

  // Face 2 — the pass-through attempt. Resuming from the T(0,0) end reorients
  // the beam so the emitter is the live end (specs/controls.md, the drawn-order
  // rule), and the move out to t(1,1) is then the emitter's second segment.
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  const reversed = [
    { col: 1, row: 1 },
    { col: 1, row: 0 },
    { col: 0, row: 0 },
  ];
  const resumed = h.snapshot();
  assertDeepEqual(
    resumed.beams.triangle?.cells,
    reversed,
    "the resume reorients the beam so the emitter is its last cell",
  );
  assertLiveTrace(
    resumed,
    "triangle",
    { col: 0, row: 0 },
    "the press on the emitter end resumes the beam there",
  );

  h.debug.pointerMove(at(1, 1).x, at(1, 1).y);
  const held = h.snapshot();
  assertDeepEqual(
    held.beams.triangle?.cells,
    reversed,
    "R5: the move out of the loaded emitter would be its second segment and " +
      "is refused — an emitter is an end of the beam and never a " +
      "pass-through (specs/beams.md R5, R6)",
  );
  assertLiveTrace(
    held,
    "triangle",
    { col: 0, row: 0 },
    "the refused pass-through leaves the trace live",
  );

  h.debug.pointerUp();
});
