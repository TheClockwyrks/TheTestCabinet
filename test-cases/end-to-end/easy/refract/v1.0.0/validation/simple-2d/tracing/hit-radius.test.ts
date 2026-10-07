// Refract — tracing/hit-radius: the pointer targets one node at a time.
//
// specs/controls.md "Targeting a node": the pointer targets the node whose
// cell center lies within NODE_HIT_R (44) of the pointer position, and targets
// no node when it is farther than NODE_HIT_R from every cell center. Both
// halves are checked with the same press, offset either side of the radius: a
// press at an emitter's center offset by NODE_HIT_R - 2 begins a trace, and a
// press offset by NODE_HIT_R + 2 — which is also farther than NODE_HIT_R from
// every OTHER cell center of the posed board — begins none and leaves the
// board unchanged.
//
// The board is GEO_3X3 (fixtures.ts), whose emitter at (0, 0) has an empty
// cell to its right: the outside press sits 46 from (0, 0), 50 from the empty
// (1, 0), and over 100 from every other center, so no neighboring region can
// catch it. The non-overlap clause — NODE_HIT_R below half CELL_PITCH (96) —
// is the specification's own arithmetic, asserted on the case's constants.
//
// The MISSED press is taken FIRST, on the board as `loadBoard` left it, so
// "the board is left unchanged" rests on a board this suite has not touched.
// Taking it after the inside press would make it rest on what the release
// before it left behind, which is `tracing/trace-empty-release`'s requirement.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLessThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  type Harness,
} from "../harness";
import { CELL_PITCH, NODE_HIT_R } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("begins a trace within NODE_HIT_R of a node's center and none beyond it", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);

  // No two targeting regions overlap: NODE_HIT_R (44) is below half
  // CELL_PITCH (96), as specs/controls.md and specs/board.md state.
  assertLessThan(
    NODE_HIT_R,
    CELL_PITCH / 2,
    "NODE_HIT_R below half CELL_PITCH, so targeting regions cannot overlap",
  );

  const emitter = nodeCenter(0, 0, 3, 3);

  // Outside the radius: NODE_HIT_R + 2 from the emitter's center, and farther
  // than NODE_HIT_R from every other cell center of this board.
  h.debug.pointerDown(emitter.x + (NODE_HIT_R + 2), emitter.y);
  const refused = h.snapshot();
  assertNull(
    refused.tracing,
    "a press farther than NODE_HIT_R from every cell center begins no trace",
  );
  assertEqual(
    refused.beams.triangle?.cells.length,
    0,
    "the board is left unchanged: the channel's beam still carries no cells",
  );
  h.debug.pointerUp();

  // Inside the radius: NODE_HIT_R - 2 from the emitter's center.
  h.debug.pointerDown(emitter.x + (NODE_HIT_R - 2), emitter.y);
  await h.advance(1);
  captureStill(h, "targeted");

  const begun = h.snapshot();
  assertNotNull(
    begun.tracing,
    "a press NODE_HIT_R - 2 from the emitter's center begins a trace " +
      "(specs/controls.md: within NODE_HIT_R targets the node)",
  );
  assertDeepEqual(
    begun.tracing?.live,
    { col: 0, row: 0 },
    "the trace begins at the targeted node",
  );
  h.debug.pointerUp();
});
