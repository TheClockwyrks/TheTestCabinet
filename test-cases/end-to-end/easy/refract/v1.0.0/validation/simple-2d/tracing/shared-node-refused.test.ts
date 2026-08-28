// Refract — tracing/shared-node-refused: a press on a node two beams share
// begins no trace.
//
// specs/controls.md "Beginning a trace": a press that matches no grab row
// begins no trace and leaves the board unchanged — and that explicitly covers
// a press on a node that MORE THAN ONE beam passes through.
//
// Only a crystal can carry two beams (R2 excludes foreign channels from
// emitters and lenses), and neither beam may END on it, or the second grab row
// would match first. The board below (a private fixture of this suite) makes
// that posable without solving: triangle crosses the two-charge crystal
// straight over the top, square crosses it by two diagonals, and the square
// lens at (0,2) stays unvisited, so the square beam is incomplete and the
// board stays in play.
//
//   T2T
//   S.S
//   s..

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  loadBoard,
  nodeCenter,
  resetTo,
  traceRoute,
  type Harness,
} from "../harness";

/** Two beams through one crystal, with the square lens keeping R9 at bay. */
const SHARED_MID = `
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

it("begins no trace on a node more than one beam passes through, leaving the board unchanged", async () => {
  await resetTo(h, 1);
  await loadBoard(h, SHARED_MID);

  // Triangle through the crystal, then square through it: (1,0) is now a mid
  // cell of BOTH beams.
  traceRoute(h, [
    [0, 0],
    [1, 0],
    [2, 0],
  ]);
  traceRoute(h, [
    [0, 1],
    [1, 0],
    [2, 1],
  ]);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "playing",
    "the shared-node press is posed in play",
  );

  const crystal = nodeCenter(1, 0, 3, 3);
  h.debug.pointerDown(crystal.x, crystal.y);
  await h.advance(1);
  captureStill(h, "unchanged");

  const after = h.snapshot();
  assertNull(
    after.tracing,
    "a press on a node more than one beam passes through matches no grab " +
      "row and begins no trace (specs/controls.md)",
  );
  assertDeepEqual(
    after.beams.triangle?.cells,
    before.beams.triangle?.cells,
    "the triangle beam is left unchanged",
  );
  assertDeepEqual(
    after.beams.square?.cells,
    before.beams.square?.cells,
    "the square beam is left unchanged",
  );
  assertDeepEqual(
    after.board.nodes,
    before.board.nodes,
    "the board's nodes are left unchanged",
  );
  assertEqual(after.screen, "playing", "the game stays on the playing screen");

  h.debug.pointerUp();
});
