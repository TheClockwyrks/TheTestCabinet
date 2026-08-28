// Refract — tracing/resume-reverses: resuming from the other end reverses the
// drawn order.
//
// specs/controls.md "The drawn order and shortening": whenever a trace begins
// on a beam, the beam is first oriented so the node the trace extends from is
// its LAST cell, reversing the held order when the trace begins from the other
// end. The reversal is asserted twice on R9_UNIQUE (fixtures.ts):
//
// 1. On the beam T(0,0)-t(0,1)-t(1,1)-t(2,1), a press on the far end T(0,0)
//    reads back the cells in reversed order, with the pressed node last.
// 2. That trace then retracts the emitter off and releases, leaving a beam
//    whose far end is a lens — t(2,1),t(1,1),t(0,1) — so a press on t(2,1)
//    both reverses the order AND extends: R5 caps an emitter at one segment,
//    so only a non-emitter far end can accept the extension the item names.
//    The extension t(2,1)-T(3,2) is a legal diagonal that completes nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { R9_UNIQUE } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reorients the beam so the pressed far end is its last cell, and extends from there", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R9_UNIQUE);
  const at = (col: number, row: number): { x: number; y: number } =>
    nodeCenter(col, row, 4, 3);

  traceRoute(h, [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ]);

  // A press on the far end — the first cell of the drawn order — reverses it.
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  const reversed = h.snapshot();
  assertNotNull(
    reversed.tracing,
    "a press on the far end of a released beam resumes it " +
      "(specs/controls.md, second grab row)",
  );
  assertDeepEqual(
    reversed.beams.triangle?.cells,
    [
      { col: 2, row: 1 },
      { col: 1, row: 1 },
      { col: 0, row: 1 },
      { col: 0, row: 0 },
    ],
    "the beam is reoriented so the pressed node is its last cell, " +
      "reversing the held order (specs/controls.md, the drawn-order rule)",
  );
  assertDeepEqual(
    reversed.tracing?.live,
    { col: 0, row: 0 },
    "the resumed trace works from the pressed end",
  );

  // Retract the emitter off and release, leaving a beam whose far end is a
  // lens — the end an extension CAN succeed from (R5 caps an emitter at one
  // segment, so the origin emitter could never accept one).
  h.debug.pointerMove(at(0, 1).x, at(0, 1).y);
  h.debug.pointerUp();
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 2, row: 1 },
      { col: 1, row: 1 },
      { col: 0, row: 1 },
    ],
    "backing the pointer onto the node behind the live end unwinds the " +
      "emitter off before the release",
  );

  // Press the far end t(2,1): reversed again, and the trace extends from it.
  h.debug.pointerDown(at(2, 1).x, at(2, 1).y);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ],
    "a press on the far end reads the cells back in reversed order",
  );

  h.debug.pointerMove(at(3, 2).x, at(3, 2).y);
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "reversed");

  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
      { col: 3, row: 2 },
    ],
    "the trace extends from the end it resumed at",
  );
});
