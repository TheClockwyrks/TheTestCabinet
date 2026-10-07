// Refract — instrumentation/pointer-operations-drive-play: `pointerDown`,
// `pointerMove`, and `pointerUp` feed the same immediate input path a player's
// pointer feeds.
//
// THE IMMEDIACY IS THE SPEC. `specs/instrumentation.md` makes each of the three
// take effect the moment it is called — resolved in the state the call returns,
// never deferred to the next update — so this whole beam is drawn with ZERO
// frames advanced between the calls, and each call's effect is asserted in its
// own aftermath. A build that queues the operations for its next frame passes a
// player's hand and fails exactly here.
//
// AND NOTHING IS BYPASSED. The press targets by `NODE_HIT_R`, the grab rules
// begin the trace, and a move the targeting cannot resolve changes nothing:
// the same hit radius, grab rules, and limits a player's pointer runs under.
// The pixel-exact boundary of the radius is `tracing/hit-radius`'s point; what
// is decided here is that the operations drive the real path, so the move
// within the radius extends and the move farther than it from every center
// leaves the beam and the trace exactly as they were.
//
// The mirrored `pointer` fields are deliberately not read between the calls:
// the snapshot's `pointer` is refreshed in every update
// (specs/instrumentation.md), and no update runs inside this sequence.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import { R3_REDRAW } from "../fixtures";
import { NODE_HIT_R } from "../notation";
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

it("draws a beam purely from code, each call resolved before the next", async () => {
  // A 3x1 board, T t T: an emitter to press, an adjacent lens to extend to,
  // and room below the row for a point farther than NODE_HIT_R from every
  // center. The first segment neither completes the beam nor solves the board.
  const board = await loadBoard(h, R3_REDRAW);
  const emitter = center(board, { col: 0, row: 0 });
  const lens = center(board, { col: 1, row: 0 });

  // pointerDown on the emitter's center begins the trace in the same call:
  // tracing is non-null before anything advances.
  await h.debug.pointerDown(emitter.x, emitter.y);
  const begun = await h.snapshot();
  assertEqual(
    begun.tracing?.channel,
    "triangle",
    "pointerDown begins the emitter's channel's trace, immediately",
  );
  assertDeepEqual(
    begun.tracing?.live,
    { col: 0, row: 0 },
    "the live end is the pressed emitter",
  );
  assertDeepEqual(
    begun.beams.triangle?.cells,
    [{ col: 0, row: 0 }],
    "the beam holds the pressed cell",
  );

  // pointerMove within NODE_HIT_R of the adjacent node adds the segment: the
  // point is 20 px from the lens's center (inside NODE_HIT_R, 44) and more
  // than NODE_HIT_R from both other centers (a cell pitch is 96).
  await h.debug.pointerMove(lens.x + 20, lens.y);
  const extended = await h.snapshot();
  assertDeepEqual(
    extended.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    `a move within NODE_HIT_R (${NODE_HIT_R}) of the adjacent node adds the segment`,
  );
  assertDeepEqual(
    extended.tracing?.live,
    { col: 1, row: 0 },
    "the live end follows the added segment",
  );

  // A move farther than NODE_HIT_R from every cell center changes nothing:
  // (688, 460) is 83 px from the two nearest centers on this board.
  await h.debug.pointerMove(688, 460);
  const unmoved = await h.snapshot();
  assertDeepEqual(
    unmoved.beams,
    extended.beams,
    "a move farther than NODE_HIT_R from every center changes no beam",
  );
  assertDeepEqual(
    unmoved.tracing,
    extended.tracing,
    "and leaves the trace live where it was",
  );

  // pointerUp ends the trace and leaves the beam as drawn.
  await h.debug.pointerUp();

  await h.advance(1);
  await captureStill(h, "drawn");

  const released = await h.snapshot();
  assertNull(released.tracing, "pointerUp ends the trace");
  assertDeepEqual(
    released.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the release leaves the beam as drawn",
  );
});
