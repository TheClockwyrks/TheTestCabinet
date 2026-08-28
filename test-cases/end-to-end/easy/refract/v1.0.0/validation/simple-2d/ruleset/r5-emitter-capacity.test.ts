// ruleset/r5-emitter-capacity — R5: an emitter carries at most one segment.
//
// The board is the R5_EMITTER fixture, `Tt / Tt`. The triangle beam runs
// T(0,0)-t(1,0)-t(1,1) in one live trace, and the probe is the diagonal from
// the live end t(1,1) back onto T(0,0): the emitter already carries its one
// segment, so a second is refused — which is exactly what makes an emitter
// impossible to pass through or re-enter (specs/beams.md R6: "an emitter is
// an end of the beam and never a pass-through" is enforced by this capacity).
//
// The probe is otherwise clean, so R5 is the only rule it breaks: T(0,0) is
// the channel's own emitter (R2 clear), the segment is fresh (R3 clear), its
// 2x2 block carries no diagonal yet (R4 clear), and the node behind the live
// end is t(1,0), so this is an extension attempt rather than a retract
// (specs/controls.md).

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

it("refuses a second segment onto an emitter already carrying its one", async () => {
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

  // The re-entry attempt: a second segment onto the emitter T(0,0).
  h.debug.pointerMove(at(0, 0).x, at(0, 0).y);
  const refused = h.snapshot();
  assertDeepEqual(
    refused.beams,
    before.beams,
    "R5: a second segment onto an emitter already carrying its one is " +
      "refused — the beam is unchanged, so an emitter is never passed " +
      "through or re-entered (specs/beams.md)",
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
});
