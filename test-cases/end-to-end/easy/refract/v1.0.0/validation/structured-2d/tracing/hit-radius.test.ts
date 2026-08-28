// Refract — tracing/hit-radius: the pointer targets one node at a time.
//
// specs/controls.md "Targeting a node": the pointer targets the node whose
// cell center lies within NODE_HIT_R (44) of the pointer position, and targets
// no node when it is farther than NODE_HIT_R from every cell center. So a
// press NODE_HIT_R - 2 from an emitter's center begins a trace, and a press
// farther than NODE_HIT_R from every center begins none. NODE_HIT_R is below
// half CELL_PITCH (96), so no two targeting regions overlap and at most one
// node is ever targeted.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThan,
  assertLessThan,
  assertNotNull,
  assertNull,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { CELL_PITCH, NODE_HIT_R, cellCenter } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a press within NODE_HIT_R of a node's center begins a trace, and one farther than NODE_HIT_R from every center begins none", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);

  // No two targeting regions overlap: NODE_HIT_R is below half CELL_PITCH
  // (specs/controls.md names the relation; the figures are the specs' own).
  assertLessThan(
    NODE_HIT_R,
    CELL_PITCH / 2,
    "NODE_HIT_R below half CELL_PITCH",
  );

  const emitter = centerOf(h, { col: 0, row: 0 });

  // Inside the radius: NODE_HIT_R - 2 from the emitter's center targets it,
  // and the press begins a trace (the emitter's beam carries no segments).
  h.debug.pointerDown(emitter.x + (NODE_HIT_R - 2), emitter.y);
  const begun = h.snapshot();
  assertNotNull(
    begun.tracing,
    "a press NODE_HIT_R - 2 from the emitter's center begins a trace",
  );
  assertDeepEqual(
    begun.tracing?.live,
    { col: 0, row: 0 },
    "the targeted node is the emitter whose center the press sits inside",
  );

  // Evidence: the trace begun inside the hit radius.
  await h.advance(1);
  captureStill(h, "targeted");
  h.debug.pointerUp();

  // Outside every radius: NODE_HIT_R + 2 along the same axis. The pose is
  // checked against the oracle geometry first: the point really is farther
  // than NODE_HIT_R from every cell center on the 3x3 grid.
  const press = { x: emitter.x + (NODE_HIT_R + 2), y: emitter.y };
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      const center = cellCenter(col, row, 3, 3);
      assertGreaterThan(
        Math.hypot(press.x - center.x, press.y - center.y),
        NODE_HIT_R,
        `the outside press sits beyond NODE_HIT_R of (${col}, ${row})`,
      );
    }
  }
  h.debug.pointerDown(press.x, press.y);
  const missed = h.snapshot();
  assertNull(
    missed.tracing,
    "a press farther than NODE_HIT_R from every cell center begins no trace",
  );
  assertDeepEqual(
    missed.beams.triangle?.cells,
    [],
    "the missed press leaves the beam untouched",
  );
  h.debug.pointerUp();
});
