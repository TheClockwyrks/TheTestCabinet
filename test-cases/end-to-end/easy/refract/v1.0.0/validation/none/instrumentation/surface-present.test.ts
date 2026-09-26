// Refract — instrumentation/surface-present: the build installed its debug and
// automation surface on `window.__refract`, whole, and really wired to the game
// on the canvas.
//
// EVERYTHING HERE IS THE BUILD'S. Under an engine the build writes the surface
// and its `initialize` returns it for the engine to hold. Nothing holds it here:
// an engineless run gets no runtime at all, so the surface itself — every
// operation, the version — and the global it is installed on are deliverables of
// this point (specs/instrumentation.md), and every other automated item on the
// checklist poses its scenario through them.
//
// The first half is that it is THERE, and whole: every operation the rendered
// specification names, including the two clock operations (`setAutoStep`,
// `advance`) that exist only under this engine because nothing else owns an
// engineless build's loop. A build that never installed the global leaves
// nothing for any check to reach the game through; this point names that fault
// plainly, and the harness reports it as `surfaceFault` rather than by throwing
// so that it lands here rather than in some other check's setup.
//
// The second half is that it is LIVE. A surface whose operations exist and do
// nothing — a plausible-looking object unconnected to the game on screen — is
// the failure mode worth naming, so the point poses a board through `loadBoard`,
// draws a segment through the pointer operations, and requires BOTH readbacks to
// move: the snapshot (the state the build holds) and the canvas (the pixels the
// build drew). The keyboard and the overlay are deliberately NOT demanded here: they
// belong to the runtime layer the build writes, and the surface carries no
// operation for them (specs/instrumentation.md).

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { R3_REDRAW } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  failSurface,
  HANDLE,
  loadBoard,
  REFRACT_DEBUG_VERSION,
  REQUIRED_OPS,
  sampleColor,
  segmentMidpoint,
  traceCells,
  type Harness,
} from "../harness";

let h: Harness;

/**
 * Fail with the harness's own account of what is missing, paired with what the
 * build owes, rather than with a comparison's rendering of it.
 *
 * `assertNull(h.surfaceFault)` would read as "Expected: null" over the reason,
 * which throws away the half of the pair that says what the build owes. This is
 * the point whose whole job is to name that plainly.
 */
function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`installs its surface on window.${HANDLE}`, async () => {
  // There is no engine to have accepted it and no seeded module to have built
  // it: the build wrote the surface and put it on the page as soon as the game
  // initialized, and either it is there or nothing in this directory can reach
  // the game. `surfaceFault` is what the harness found when it looked, and it
  // names the missing piece.
  requireSurface();

  const { version } = await h.probe([]);
  assertEqual(typeof version, "number");
});

it("carries the version and every required operation, as functions", async () => {
  requireSurface();
  const probed = await h.probe(REQUIRED_OPS);

  assertEqual(probed.version, REFRACT_DEBUG_VERSION);
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }
});

it("is live: a posed board and a traced segment move the snapshot and the canvas", async () => {
  requireSurface();

  // A 3x1 board whose first segment neither completes the beam nor solves the
  // board, so the reading is of a plain segment on the playing screen with no
  // screen change tangled into it. The pose itself must land: `loadBoard` puts
  // an arbitrary board into play with every beam empty (specs/instrumentation.md).
  const board = await loadBoard(h, R3_REDRAW);
  const before = await h.snapshot();
  assertEqual(before.screen, "playing", "loadBoard moves to playing");
  assertEqual(before.board.cols, board.cols, "the posed board's cols");
  assertEqual(before.board.rows, board.rows, "the posed board's rows");
  assertDeepEqual(
    before.beams.triangle?.cells,
    [],
    "a posed board starts with the channel's beam empty",
  );

  // Where the first segment will lie, sampled before and after the trace: the
  // segment joins the two cell centers, so its midpoint is on the beam's route
  // (specs/board.md's cell center formula, specs/ui.md's beam rendering).
  const midpoint = segmentMidpoint(
    board,
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  );
  const bare = await sampleColor(h, midpoint.x, midpoint.y);

  // Drawn purely from code, through the game's own pointer path, and rendered
  // by the one frame that follows.
  await traceCells(h, [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
  ]);
  await h.advance(1);
  await captureStill(h, "state");

  const after = await h.snapshot();
  assertDeepEqual(
    after.beams.triangle?.cells,
    [
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ],
    "the traced segment is in the snapshot",
  );

  const drawn = await sampleColor(h, midpoint.x, midpoint.y);
  assertGreaterThan(
    colorDistance(drawn, bare),
    0,
    "the traced segment is on the canvas: the segment's midpoint changed",
  );
});
