// Refract — tracing/grab-end-wins-over-mid: a beam's end wins over another
// beam's middle.
//
// specs/controls.md "Beginning a trace": the grab rows are EVALUATED IN ORDER,
// and the first row that matches applies. A node that is one beam's end (row
// two) and a mid cell of another (row three) must therefore resume the beam
// whose end it is.
//
// Only a crystal can be a cell of two beams (R2), so the pose is: triangle
// crosses the two-charge crystal as a mid cell, and square's beam ENDS on it —
// a crossing begun and not completed, which R5 permits while an unspent charge
// remains. The board is this suite's private fixture (the square lens keeps
// the board unsolvable mid-scene):
//
//   T2T
//   S.S
//   s..
//
// The press must resume SQUARE from the crystal; extending on to S(2,1) then
// proves the resumed trace really is square's, through a segment triangle
// could never draw (R2 excludes it from square's emitter).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";

/** Crystal shared as triangle's mid cell and square's end. */
const END_OVER_MID = `
T2T
S.S
s..
`;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes the beam whose end the pressed node is, not the one it is a mid cell of", async () => {
  await resetTo(h);
  await loadBoard(h, END_OVER_MID);

  // Triangle passes through the crystal; square ends on it.
  traceRoute(h, [
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
  traceRoute(h, [
    [0, 1],
    [1, 0],
  ]);
  const before = h.snapshot();

  const crystal = nodeCenter(1, 0, 3, 3);
  h.debug.pointerDown(crystal.x, crystal.y);
  await h.advance(1);
  captureStill(h, "grabbed");

  const grabbed = h.snapshot();
  assertNotNull(
    grabbed.tracing,
    "a press on a node that is one beam's end begins a trace " +
      "(specs/controls.md, second grab row)",
  );
  assertEqual(
    grabbed.tracing?.channel,
    "square",
    "the grab rows are evaluated in order, so the beam whose END the node " +
      "is — square's — is the one resumed (specs/controls.md)",
  );
  assertDeepEqual(
    grabbed.tracing?.live,
    { col: 1, row: 0 },
    "the trace resumes from the pressed end",
  );
  assertDeepEqual(
    grabbed.beams.triangle?.cells,
    before.beams.triangle?.cells,
    "the beam the node is only a mid cell of is left unchanged",
  );

  // The resumed trace is square's: it extends to square's own emitter.
  const out = nodeCenter(2, 1, 3, 3);
  h.debug.pointerMove(out.x, out.y);
  h.debug.pointerUp();
  assertDeepEqual(
    h.snapshot().beams.square?.cells,
    [
      { col: 0, row: 1 },
      { col: 1, row: 0 },
      { col: 2, row: 1 },
    ],
    "the resumed trace extends square's beam from the grabbed end",
  );
});
