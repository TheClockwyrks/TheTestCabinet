// Refract — tracing/shorten-keeps-last-occurrence: shortening keeps a
// repeated node's last occurrence.
//
// specs/controls.md "The drawn order and shortening": a beam that crosses a
// node more than once carries that node more than once, and the last of those
// occurrences in the held order is the one kept, so the beam loses as few
// segments as it can.
//
// The board is CRYSTAL_TWICE (fixtures.ts): the two-charge crystal at (1,1) is
// entered and left twice by the one triangle beam. The route stops one segment
// short of the solve — [T(0,0), 2(1,1), t(0,2), t(1,2), 2(1,1), t(1,0),
// t(2,1)] — so the trace machinery is still live, the crystal's cell sits at
// drawn-order indices 1 and 4, and a press on it must keep index 4: five
// cells survive, not two.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNotNull } from "../assert";
import { CRYSTAL_TWICE } from "../fixtures";
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

it("drops the cells after the pressed node's LAST occurrence in the drawn order", async () => {
  await resetTo(h, 1);
  await loadBoard(h, CRYSTAL_TWICE);

  // Both crossings of the crystal, stopping short of the solving segment.
  traceRoute(h, [
    [0, 0],
    [1, 1],
    [0, 2],
    [1, 2],
    [1, 1],
    [1, 0],
    [2, 1],
  ]);
  assertDeepEqual(
    h.snapshot().beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 0, row: 2 },
      { col: 1, row: 2 },
      { col: 1, row: 1 },
      { col: 1, row: 0 },
      { col: 2, row: 1 },
    ],
    "a beam that crosses a crystal twice carries that cell twice " +
      "(specs/controls.md, the drawn-order rule)",
  );

  // Press the twice-carried crystal cell.
  const crystal = nodeCenter(1, 1, 4, 3);
  h.debug.pointerDown(crystal.x, crystal.y);
  await h.advance(1);
  captureStill(h, "shortened");

  const snapshot = h.snapshot();
  assertDeepEqual(
    snapshot.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
      { col: 0, row: 2 },
      { col: 1, row: 2 },
      { col: 1, row: 1 },
    ],
    "shortening drops the cells after the pressed node's LAST occurrence, " +
      "so the beam loses as few segments as it can (specs/controls.md)",
  );
  assertNotNull(
    snapshot.tracing,
    "the trace resumes from the pressed node (specs/controls.md, shortening)",
  );
  assertDeepEqual(
    snapshot.tracing?.live,
    { col: 1, row: 1 },
    "the live end is the kept occurrence of the pressed node",
  );

  h.debug.pointerUp();
});
