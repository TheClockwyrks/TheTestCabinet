// Refract — instrumentation/pointer-operations-drive-play: the surface's
// pointer operations feed the same immediate input path a player's pointer
// feeds.
//
// specs/instrumentation.md: each of pointerDown, pointerMove, and pointerUp
// takes effect immediately, when it is called, rather than being sampled once
// per update — the press, the move, or the release is resolved in the state
// the call returns — so a whole route can be drawn from code without a frame
// passing between the calls. And nothing is bypassed: a press targets the node
// whose cell center is within NODE_HIT_R (44) of the point (specs/controls.md
// "Targeting a node"), a move within NODE_HIT_R of a node adjacent to the live
// end adds the segment, a move farther than NODE_HIT_R from every center
// targets nothing and changes nothing, and the release ends the trace and
// leaves the beam as drawn.
//
// The whole scenario therefore runs with ZERO frames advanced between the
// calls, asserting each call's effect in its own aftermath — the immediacy is
// the spec. The board is GEO_3X3 (spec-derived, fixtures.ts): a press on the
// emitter T(0,0), a move landing 36 px from the lens t(1,1)'s center (inside
// NODE_HIT_R, a legal R1 diagonal), a move to a point at least 67 px from
// every cell center (outside NODE_HIT_R of everything), and the release.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertNotNull,
  assertNull,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellX, cellY } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a beam purely from code, each call taking effect as it is made", async () => {
  await resetTo(h, 1);
  await loadBoard(h, GEO_3X3);

  // The press, on the emitter's center: the trace begins in the same call —
  // tracing is non-null before anything advances.
  h.debug.pointerDown(cellX(0, 3), cellY(0, 3));
  const pressed = h.snapshot();
  assertNotNull(
    pressed.tracing,
    "pointerDown on an emitter's center begins a trace in the same call",
  );
  assertEqual(pressed.tracing?.channel, "triangle", "the trace's channel");
  assertDeepEqual(
    pressed.tracing?.live,
    { col: 0, row: 0 },
    "the trace begins at the pressed emitter",
  );

  // The move, 36 px from the adjacent lens t(1,1)'s center — within
  // NODE_HIT_R (44), so the lens is targeted and the segment is added, in the
  // same call.
  h.debug.pointerMove(cellX(1, 3) + 30, cellY(1, 3) + 20);
  const extended = h.snapshot();
  assertDeepEqual(
    extended.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "pointerMove within NODE_HIT_R (44) of an adjacent node adds the segment",
  );
  assertDeepEqual(
    extended.tracing?.live,
    { col: 1, row: 1 },
    "the reached node becomes the live end",
  );

  // A move farther than NODE_HIT_R from every cell center: (592, 344) is at
  // least 67 px from each of the 3x3 board's centers (544/640/736 by
  // 296/392/488), so it targets nothing and changes nothing.
  h.debug.pointerMove(592, 344);
  const missed = h.snapshot();
  assertDeepEqual(
    missed.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "a move farther than NODE_HIT_R from every center changes nothing",
  );
  assertNotNull(missed.tracing, "and the trace stays live");
  assertDeepEqual(
    missed.tracing?.live,
    { col: 1, row: 1 },
    "the live end is unmoved",
  );

  // The release ends the trace and leaves the beam as drawn.
  h.debug.pointerUp();
  const released = h.snapshot();
  assertNull(released.tracing, "pointerUp ends the trace");
  assertDeepEqual(
    released.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "the release leaves the beam exactly as drawn",
  );

  // Evidence only: the first frame since the board was posed, so the picture
  // shows the beam that was drawn purely from code.
  await h.advance(1);
  captureStill(h, "drawn");
});
