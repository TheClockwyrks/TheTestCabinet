// Refract — tracing/release-leaves-partial: releasing leaves the beam as
// drawn.
//
// specs/controls.md "Releasing": the release edge ends the trace and leaves
// the beam exactly as drawn, complete or not. A partial beam persists on the
// board, and a later press on either of its ends resumes it.
//
// The board is R9_UNIQUE (fixtures.ts) and the beam T(0,0)-t(0,1)-t(1,1) is
// deliberately incomplete (its route needs two more segments), so what
// persists is a PARTIAL beam. Both ends are then pressed in turn — the live
// end t(1,1) and the far end T(0,0) — and each press must resume the trace.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
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

it("keeps the partial beam in the snapshot, and a press on either end resumes it", async () => {
  await resetTo(h);
  await loadBoard(h, R9_UNIQUE);
  const at = (col: number, row: number): { x: number; y: number } =>
    nodeCenter(col, row, 4, 3);

  // Draw two segments and release (trace releases at the end of its route).
  traceRoute(h, [
    [0, 0],
    [0, 1],
    [1, 1],
  ]);
  await h.advance(1);
  captureStill(h, "partial");

  const released = h.snapshot();
  assertNull(released.tracing, "the release ends the trace");
  assertDeepEqual(
    released.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ],
    "the release leaves the beam exactly as drawn (specs/controls.md, " +
      "Releasing)",
  );
  assertEqual(
    released.beams.triangle?.complete,
    false,
    "the persisting beam is partial: it has not met R6 and R7",
  );

  // A press on the live end resumes the trace.
  h.debug.pointerDown(at(1, 1).x, at(1, 1).y);
  const fromLiveEnd = h.snapshot();
  assertNotNull(
    fromLiveEnd.tracing,
    "a later press on the beam's live end resumes it",
  );
  assertDeepEqual(fromLiveEnd.tracing?.live, { col: 1, row: 1 });
  h.debug.pointerUp();
  assertEqual(
    h.snapshot().beams.triangle?.cells.length,
    3,
    "the empty-handed resume's release leaves the partial beam as drawn",
  );

  // And so does a press on the far end.
  h.debug.pointerDown(at(0, 0).x, at(0, 0).y);
  const fromFarEnd = h.snapshot();
  assertNotNull(
    fromFarEnd.tracing,
    "a later press on the beam's other end resumes it too",
  );
  assertDeepEqual(fromFarEnd.tracing?.live, { col: 0, row: 0 });
  h.debug.pointerUp();
});
