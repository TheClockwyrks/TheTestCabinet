// Refract — tracing/hit-radius: the pointer targets one node at a time.
//
// `specs/controls.md` "Targeting a node": the pointer targets the node whose
// cell center lies within NODE_HIT_R (44) of the pointer position, and targets
// no node when it is farther than NODE_HIT_R from every cell center. The two
// presses here sit either side of that radius, both measured from the SAME
// emitter's center — 42 out (in, begins its trace) and 48 out (past the
// radius, begins none) — so the figure asserted is the spec's own, not a
// build's. The third clause is arithmetic the same file fixes: NODE_HIT_R is
// below half CELL_PITCH (96), which is what makes "at most one node is ever
// targeted" true, and it is asserted as the constants relation it is.
//
// WHY THE OUTSIDE PRESS IS ON THE DIAGONAL. It has to be a press a WIDER
// radius would answer, or the check cannot see a build that widened one. On
// the x axis, NODE_HIT_R + 4 out from the emitter is exactly half of
// CELL_PITCH, so the nearest cell center is the NEIGHBOUR's — and a press on a
// bare lens begins no trace at any radius, which would leave the assertion
// true however wide the build's radius was. Taken diagonally instead, the same
// distance is (NODE_HIT_R + 4) / sqrt(2) ≈ 33.9 on each axis: still well
// inside half the pitch, so the nearest center is the emitter's own — the one
// node here that a press DOES grab — while every center on the board, that
// emitter's included, is farther than NODE_HIT_R away. A build holding the
// specified radius begins nothing; a build that widened it begins the trace
// this assertion forbids.
//
// The presses go through the surface's `pointerDown`, which feeds the same
// input path a player's press feeds, hit radius included
// (`specs/instrumentation.md` — "nothing is bypassed").

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLessThan, assertNull } from "../assert";
import { R3_REDRAW } from "../fixtures";
import { CELL_PITCH, NODE_HIT_R } from "../notation";
import {
  captureStill,
  center,
  createHarness,
  loadBoard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins a trace within NODE_HIT_R of a node, and none past it", async () => {
  // No two targeting regions can overlap: the radius is under half the pitch.
  assertLessThan(
    NODE_HIT_R,
    CELL_PITCH / 2,
    "NODE_HIT_R (44) below half CELL_PITCH (96), specs/controls.md",
  );

  // A 3x1 board: the emitter at (0, 0) and its neighbouring cell center are a
  // full CELL_PITCH apart on the x axis, so a point 42 out from the emitter is
  // 54 from the neighbour — inside exactly one targeting region.
  const board = await loadBoard(h, R3_REDRAW);
  const emitter = center(board, { col: 0, row: 0 });

  await h.debug.pointerDown(emitter.x + (NODE_HIT_R - 2), emitter.y);
  await h.advance(1);
  await captureStill(h, "targeted");
  const inside = await h.snapshot();
  assertDeepEqual(
    inside.tracing,
    { channel: "triangle", live: { col: 0, row: 0 } },
    "a press NODE_HIT_R - 2 from the emitter's center begins its trace",
  );
  await h.debug.pointerUp();

  // 48 out from (0, 0) on the diagonal — 33.9 on each axis, so the emitter's
  // is still the nearest cell center and the neighbour's is 70.7 away.
  // Farther than NODE_HIT_R from every cell center on the board, so no node is
  // targeted and no trace begins.
  const out = (NODE_HIT_R + 4) / Math.SQRT2;
  await h.debug.pointerDown(emitter.x + out, emitter.y + out);
  const outside = await h.snapshot();
  assertNull(
    outside.tracing,
    "a press farther than NODE_HIT_R from every cell center begins no trace",
  );
  await h.debug.pointerUp();
});
