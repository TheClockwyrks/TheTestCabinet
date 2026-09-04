// Refract — tracing/resume-from-end: a press on a beam's end resumes it.
//
// specs/controls.md "Beginning a trace", second grab row: a press on either
// end of a channel's beam resumes that beam from that end. Here the end
// pressed is the LIVE end — the last cell of the drawn order — so the order is
// unchanged and the resumed trace extends straight on: "Extending" says the
// pointer moving within NODE_HIT_R of a node adjacent to the live end adds the
// segment joining them.
//
// The board is R9_UNIQUE (fixtures.ts). The beam T(0,0)-t(0,1)-t(1,1) is drawn
// through the pointer operations (which releases), then pressed at t(1,1) and
// extended to t(2,1) — a legal orthogonal segment that completes nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
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

it("resumes the released beam from its live end, and an extension succeeds", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R9_UNIQUE);

  traceRoute(h, [
    [0, 0],
    [0, 1],
    [1, 1],
  ]);
  assertEqual(
    h.snapshot().tracing,
    null,
    "after trace's release, no trace is live",
  );

  // Press the live end — the beam's last cell, t(1,1).
  const end = nodeCenter(1, 1, 4, 3);
  h.debug.pointerDown(end.x, end.y);

  const resumed = h.snapshot();
  assertNotNull(
    resumed.tracing,
    "a press on the beam's live end resumes it (specs/controls.md, " +
      "second grab row)",
  );
  assertDeepEqual(
    resumed.tracing?.live,
    { col: 1, row: 1 },
    "the trace resumes from the pressed end",
  );
  assertDeepEqual(
    resumed.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
    ],
    "resuming from the live end leaves the drawn order as it was",
  );

  // The resumed trace extends: one move to the adjacent lens t(2,1).
  const next = nodeCenter(2, 1, 4, 3);
  h.debug.pointerMove(next.x, next.y);
  h.debug.pointerUp();
  await h.advance(1);
  captureStill(h, "resumed");

  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ],
    "an extension from the resumed end to an adjacent node succeeds",
  );
});
