// Refract — tracing/shorten-from-middle: a press inside a beam shortens it to
// that node.
//
// specs/controls.md "Beginning a trace", third grab row, and "The drawn order
// and shortening": a press on a node exactly one beam passes through shortens
// that beam to end at that node — dropping every cell after it in the drawn
// order, leaving the rest drawn — and resumes the trace from there.
//
// The board is R9_UNIQUE (fixtures.ts). The beam T(0,0)-t(0,1)-t(1,1)-t(2,1)
// is drawn and released; t(0,1) is a mid cell (neither end), and only the one
// triangle beam exists, so the press unambiguously matches the third row.

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

it("drops every cell after the pressed node, keeps the rest, and resumes there", async () => {
  await resetTo(h, 1);
  await loadBoard(h, R9_UNIQUE);

  traceRoute(h, [
    [0, 0],
    [0, 1],
    [1, 1],
    [2, 1],
  ]);

  // Press the mid cell t(0,1).
  const mid = nodeCenter(0, 1, 4, 3);
  h.debug.pointerDown(mid.x, mid.y);
  await h.advance(1);
  captureStill(h, "shorten");

  const snapshot = h.snapshot();
  assertDeepEqual(
    snapshot.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 0, row: 1 },
    ],
    "every cell after the pressed node in the drawn order is dropped, and " +
      "the rest of the beam is left drawn (specs/controls.md, shortening)",
  );
  assertNotNull(
    snapshot.tracing,
    "a press on a node exactly one beam passes through resumes a trace " +
      "(specs/controls.md, third grab row)",
  );
  assertEqual(
    snapshot.tracing?.channel,
    "triangle",
    "the trace carries the shortened beam's channel",
  );
  assertDeepEqual(
    snapshot.tracing?.live,
    { col: 0, row: 1 },
    "the trace resumes from the pressed node",
  );

  h.debug.pointerUp();
});
