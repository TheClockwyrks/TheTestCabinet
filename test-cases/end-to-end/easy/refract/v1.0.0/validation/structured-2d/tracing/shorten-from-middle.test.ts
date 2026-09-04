// Refract — tracing/shorten-from-middle: a press inside a beam shortens it to
// that node.
//
// specs/controls.md "Beginning a trace", the third grab row, and "The drawn
// order and shortening": a press on a node exactly one beam passes through
// shortens that beam to end at that node — every cell after it in the drawn
// order is dropped, the rest of the beam is left drawn — and resumes the
// trace from there.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { GEO_7X6 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  pressCell,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";

const A = { col: 0, row: 0 };
const B = { col: 1, row: 1 };
const C = { col: 2, row: 2 };
const D = { col: 3, row: 3 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a press on a mid node drops every cell after it, leaves the rest drawn, and resumes the trace there", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_7X6);

  // Draw A -> B -> C -> D and release. B is a mid cell of exactly one beam.
  traceCells(h, [A, B, C, D]);
  assertNull(h.snapshot().tracing, "the drawing trace ended with its release");

  pressCell(h, B);

  const snap = h.snapshot();
  assertDeepEqual(
    snap.beams.triangle?.cells,
    [A, B],
    "every cell after the pressed node is dropped and the rest stays drawn",
  );
  assertDeepEqual(
    snap.tracing?.live,
    B,
    "the trace resumes from the pressed node",
  );
  assertEqual(
    snap.tracing?.channel,
    "triangle",
    "the resumed trace carries the shortened beam's channel",
  );

  // Evidence: the beam shortened to the pressed node, trace still live.
  await h.advance(1);
  captureStill(h, "shorten");
  h.debug.pointerUp();
});
