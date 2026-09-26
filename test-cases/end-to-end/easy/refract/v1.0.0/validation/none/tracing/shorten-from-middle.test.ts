// Refract — tracing/shorten-from-middle: a press inside a beam shortens it to
// that node.
//
// The third row of the grab table in `specs/controls.md`, and the shortening
// rule under "The drawn order and shortening": a press on a node exactly one
// beam passes through drops every cell after the targeted node in the drawn
// order, leaves the rest of the beam drawn, and resumes the trace from that
// node. The beam here is [A, B, C, D] on a single-channel line, and the press
// lands on B — a mid cell of the one beam on the board — so what must remain
// is exactly [A, B], with the trace live at B.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  traceCells,
  type Harness,
} from "../harness";
import { LINE_5 } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops the cells after the pressed node and resumes there", async () => {
  const board = await loadBoard(h, LINE_5);
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
    { col: 3, row: 0 },
  ]);
  const drawn = await h.snapshot();
  assertDeepEqual(
    drawn.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
    ],
    "the beam holds four cells before the press",
  );

  // B (1, 0) is a mid cell of the one beam on the board: the press shortens
  // the beam to end there and resumes the trace from it.
  const b = center(board, { col: 1, row: 0 });
  await h.debug.pointerDown(b.x, b.y);
  await h.advance(1);
  await captureStill(h, "shorten");

  const after = await h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "every cell after the pressed node is dropped; the rest stays drawn",
  );
  assertDeepEqual(
    after.tracing,
    { channel: "triangle", live: { col: 1, row: 0 } },
    "the trace resumes from the pressed node",
  );
  await h.debug.pointerUp();
});
