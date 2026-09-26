// Refract — instrumentation/surface-present: the build returned its debug and
// automation surface from initialize, the surface is whole, and it is really
// wired to the running game.
//
// TWO HALVES, AND BOTH ARE THE BUILD'S.
//
// The first is the surface itself. specs/instrumentation.md specifies every
// operation, and the build implements them and returns the finished surface
// from its instance's `initialize`. The engine holds that value and hands it
// back from `engine.debug`, and nothing else can reach a check: a build that
// returned no surface leaves `engine.debug` with nothing to hand over. That is
// what the first check below establishes, reading the surface off the engine
// the harness constructed, and the second holds it to the version and the
// operation list the specification fixes. The clock, the keyboard, the
// pointer, and the overlay are the engine's under this engine, so the surface
// carries no operation for any of them — `setAutoStep` and `advance` belong to
// the engineless build alone, and demanding either here would fail a perfectly
// conformant build.
//
// The second half is the game behind it. An operation that exists but arranges
// nothing the running game honors — a `loadBoard` that reports a plausible
// board the renderer never drew, a segment the snapshot alone believes — is a
// surface that is present and useless, and that is the failure mode this
// item's description names: `loadBoard` poses a board, a press and a move draw
// a segment on it, and BOTH the snapshot and the rendered canvas change.
//
// Every other automated item drives this surface to pose its own scenario, so
// a missing surface or an operation that does not act also shows up as those
// items failing to run. This one names the fault plainly.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertDoesNotThrow,
  assertEqual,
  assertGreaterThan,
  assertNotNull,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  canvasPixels,
  captureStill,
  createHarness,
  loadBoard,
  pixelsChanged,
  resetTo,
  traceCells,
  type Harness,
} from "../harness";
import { REFRACT_DEBUG_VERSION, REQUIRED_OPS } from "../surface";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its debug surface from initialize", () => {
  // `engine.debug` is whatever the build's instance returned from `initialize`,
  // so reading it is the check: there is no page property to look for and
  // nothing the harness could have supplied in the build's place. A build whose
  // `initialize` returned nothing never gets this far, because the engine
  // rejects `initialize` itself.
  assertDoesNotThrow(() => h.engine.debug);
  assertNotNull(h.engine.debug);

  // The engine hands back the value the instance returned, unchanged and
  // unwrapped, so every read is the same object. It is the one the rest of this
  // suite — and every other check in this directory — poses the game through:
  // `h.debug` is this object, driven directly, each operation acting on the
  // live game at the moment of the call.
  assertEqual(h.engine.debug, h.engine.debug);
  assertEqual(typeof h.engine.debug, "object");
});

it("carries a version and every specified operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  assertEqual(typeof api.version, "number");
  assertEqual(api.version, REFRACT_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(typeof api[op], "function", `the ${op} operation`);
  }
});

it("is live: loadBoard poses a board, trace draws on it, and the snapshot and the canvas both change", async () => {
  // A clean, rendered title to measure every change against.
  await resetTo(h);
  const title = h.snapshot();
  assertEqual(title.screen, "title");
  const titlePixels = canvasPixels(h);

  // `loadBoard` poses a board and moves to `playing` with every beam empty
  // (specs/instrumentation.md). The snapshot reports the posed board, and the
  // frame that lands it draws something the title frame did not.
  await loadBoard(h, GEO_3X3);
  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "loadBoard moves to playing");
  assertEqual(posed.board.cols, 3, "the posed board's cols");
  assertEqual(posed.board.rows, 3, "the posed board's rows");
  assertEqual(posed.board.nodes.length, 3, "the posed board's node count");
  assertDeepEqual(
    posed.beams.triangle?.cells,
    [],
    "a posed board opens with every beam empty",
  );
  const boardPixels = canvasPixels(h);
  assertGreaterThan(
    pixelsChanged(titlePixels, boardPixels),
    0,
    "the rendered canvas changes when a board is posed",
  );

  // The pointer operations draw a real segment — each resolved at the call,
  // subject to every limit — and the drawn beam both reads back in the
  // snapshot and lands on the canvas the next rendered frame.
  traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 1 },
  ]);
  const traced = h.snapshot();
  assertDeepEqual(
    traced.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    ],
    "the traced segment reads back from the snapshot",
  );
  assertEqual(traced.solved, false, "one segment of three does not solve");

  await h.advance(1);
  // The driven in-game state: the posed board with the traced segment drawn.
  captureStill(h, "state");
  assertGreaterThan(
    pixelsChanged(boardPixels, canvasPixels(h)),
    0,
    "the rendered canvas changes when a segment is traced",
  );
});
