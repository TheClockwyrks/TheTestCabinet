// Refract — instrumentation/surface-present: the debug and automation surface
// is present, whole, and live.
//
// specs/instrumentation.md makes the surface a deliverable of the build: its
// `initialize` returns the finished surface beside the state, as
// `[state, debug]`, the engine returns that same value from `engine.debug`,
// and it is reached that way alone — nothing is installed on the page. Every
// other suite on this checklist poses its scenario through it, so a missing
// surface also shows up as every other suite failing to run; this one names
// the fault plainly.
//
// TWO HALVES, AND BOTH ARE THE BUILD'S. The first is presence: `version`
// reports REFRACT_DEBUG_VERSION (2), and every operation the rendered
// specification names for an engine build — reset, snapshot, setMode,
// setScreen, setMenuIndex, setSolvedCount, setTier, generateBoard, loadBoard,
// the three pointer operations, and clear — is a function on the surface. `setAutoStep` and `advance` are NOT demanded: the clock is
// the engine's under this engine, and the specification gives those two
// operations to the engineless build alone.
//
// The second half is liveness. A surface that reports a plausible-looking
// object unconnected to the running game is the failure mode worth naming, so
// the check poses a board through `loadBoard`, draws a segment through the
// pointer operations, and requires that BOTH readbacks move: the snapshot (the
// posed board's cells, the drawn beam) and the rendered canvas (the frame after
// the segment differs from the frame before it). The scenario board is GEO_3X3 —
// spec-derived, from fixtures.ts — and the traced hop T(0,0) -> t(1,1) is a
// legal R1 diagonal that does not complete the beam, so what is read is an
// ordinary mid-play state.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertDeepEqual,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  createHarness,
  loadBoard,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";
import { parseBoard } from "../notation";
import { REFRACT_DEBUG_VERSION, REQUIRED_OPS } from "../surface";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its debug surface beside its state from initialize", () => {
  // `engine.debug` is whatever the build's `initialize` returned as the second
  // element of `[state, debug]`, so reading it is the check: there is no page
  // property to look for and nothing the harness could have supplied in the
  // build's place. A build that returned `null` there has no surface.
  assertNotNull(h.engine.debug);
  assertEqual(typeof h.engine.debug, "object");
});

it("carries the version and every specified operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  assertEqual(typeof api.version, "number", "version is a plain number");
  assertEqual(api.version, REFRACT_DEBUG_VERSION, "REFRACT_DEBUG_VERSION");
  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof api[op],
      "function",
      `specs/instrumentation.md names ${op} as an operation of the surface`,
    );
  }
});

it("is live: loadBoard poses a board, trace draws on it, and both the snapshot and the canvas change", async () => {
  await resetTo(h);
  await loadBoard(h, GEO_3X3);

  // The posed board is the one the snapshot reports: the same cells, kinds,
  // and channels the notation wrote, so the surface reads the running game
  // rather than an object of its own.
  const want = parseBoard(GEO_3X3);
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "loadBoard moves to playing");
  assertEqual(posed.board.cols, want.cols, "the posed board's cols");
  assertEqual(posed.board.rows, want.rows, "the posed board's rows");
  assertDeepEqual(
    posed.board.nodes
      .map((n) => `${n.col},${n.row}:${n.kind}:${String(n.channel)}`)
      .sort(),
    want.nodes
      .map((n) => `${n.col},${n.row}:${n.kind}:${String(n.channel)}`)
      .sort(),
    "the posed board's nodes, as specs/board.md notation wrote them",
  );

  const before = h.ctx.getImageData(0, 0, h.canvas.width, h.canvas.height);

  // One legal hop, drawn purely from code through the surface's pointer
  // operations.
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  await h.advance(1);
  captureStill(h, "state");

  // The snapshot changed: the drawn segment is in the beam, in drawn order.
  const drawn = h.snapshot();
  assertDeepEqual(
    drawn.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "the drawn segment is in the channel's beam",
  );

  // And the canvas changed: the frame after the trace differs from the frame
  // before it, so the surface drives the game that is actually rendering.
  const after = h.ctx.getImageData(0, 0, h.canvas.width, h.canvas.height);
  let changed = 0;
  for (let i = 0; i < after.data.length; i += 1) {
    if (after.data[i] !== before.data[i]) changed += 1;
  }
  assertGreaterThan(
    changed,
    0,
    "the rendered canvas changes once the traced beam is drawn",
  );
});
