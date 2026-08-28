// Refract — instrumentation/pointer-operations-drive-play: the pointer
// operations feed the same immediate input path a player's pointer feeds.
//
// The immediacy IS the specification (specs/instrumentation.md: each of the
// three takes effect when it is called, resolved before the call returns, so
// a whole route is drawn from code without advancing the game at all) — so
// this suite advances NOTHING between the pointer calls and asserts each
// call's effect in its own aftermath:
//
//   - pointerDown on an emitter's center begins a trace in the same call;
//   - pointerMove within NODE_HIT_R (44) of an adjacent node's center — off
//     the center itself, so the hit RADIUS is what targets — adds the segment;
//   - a move farther than NODE_HIT_R from every center changes nothing;
//   - pointerUp ends the trace and leaves the beam as drawn.
//
// The board is GEO_3X3 (T at (0,0), t at (1,1), T at (2,2)): one legal
// diagonal segment short of solving, so nothing here trips R9's
// solving-ends-the-trace behavior (that belongs to other items).

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
  centerOf,
  createHarness,
  loadBoard,
  resetTo,
  type Harness,
} from "../harness";
import { cellCenter, NODE_HIT_R } from "../notation";

/**
 * A point farther than NODE_HIT_R (44) from every cell center of the posed
 * 3x3 board: centers sit on x {544, 640, 736} and y {296, 392, 488}
 * (specs/board.md), and (592, 344) is 48 off the nearest of each — a distance
 * of 48 * sqrt(2), about 67.9.
 */
const DEAD_POINT = { x: 592, y: 344 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("presses, extends by hit radius, ignores a dead move, and releases — all at the call", async () => {
  await resetTo(h, 1);
  const oracle = await loadBoard(h, GEO_3X3);

  // The dead point really is beyond NODE_HIT_R of every center.
  for (const node of oracle.nodes) {
    const center = cellCenter(node.col, node.row, oracle.cols, oracle.rows);
    assertLessThan(
      NODE_HIT_R,
      Math.hypot(center.x - DEAD_POINT.x, center.y - DEAD_POINT.y),
      `the dead point clears the node at (${node.col}, ${node.row})`,
    );
  }

  // pointerDown on the emitter's center begins a trace IN THE SAME CALL:
  // tracing is non-null before anything advances.
  const emitter = centerOf(h, { col: 0, row: 0 });
  h.debug.pointerDown(emitter.x, emitter.y);
  const pressed = h.snapshot();
  assertNotNull(pressed.tracing, "tracing begins in the pointerDown call");
  assertEqual(pressed.tracing?.channel, "triangle", "the grabbed channel");
  assertDeepEqual(
    pressed.tracing?.live,
    { col: 0, row: 0 },
    "the live end is the pressed emitter",
  );
  assertEqual(pressed.pointer.down, true, "the pointer reads pressed");

  // pointerMove within NODE_HIT_R of the adjacent lens — 36.06 from its
  // center, inside the 44 radius but well off the center itself — adds the
  // segment at the call.
  const lens = centerOf(h, { col: 1, row: 1 });
  h.debug.pointerMove(lens.x + 30, lens.y + 20);
  const extended = h.snapshot();
  assertDeepEqual(
    extended.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "the move within NODE_HIT_R adds the segment",
  );
  assertDeepEqual(
    extended.tracing?.live,
    { col: 1, row: 1 },
    "the live end follows the added segment",
  );

  // A move farther than NODE_HIT_R from every center changes nothing: the
  // beam and the trace are exactly as the previous call left them.
  h.debug.pointerMove(DEAD_POINT.x, DEAD_POINT.y);
  const afterDead = h.snapshot();
  assertDeepEqual(
    afterDead.beams,
    extended.beams,
    "a dead move changes no beam",
  );
  assertDeepEqual(
    afterDead.tracing,
    extended.tracing,
    "a dead move leaves the trace live and unchanged",
  );

  // pointerUp ends the trace at the call and leaves the beam as drawn.
  h.debug.pointerUp();
  const released = h.snapshot();
  assertNull(released.tracing, "pointerUp ends the trace");
  assertEqual(released.pointer.down, false, "the pointer reads released");
  assertDeepEqual(
    released.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "the release leaves the beam as drawn",
  );

  // Evidence only, after the route is fully drawn: the frame that renders the
  // beam drawn purely from code.
  await h.advance(1);
  captureStill(h, "drawn");
});
