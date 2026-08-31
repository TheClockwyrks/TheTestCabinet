// Meltdown — instrumentation/surface-present: the build installed its debug and
// automation surface on `window.__meltdown`, that surface is whole, and it is
// really wired to the running game.
//
// ALL OF IT IS THE BUILD'S. Under an engine the build writes the surface and the
// engine holds it. Nothing holds it here: an engineless run gets no runtime at
// all, so the global, every operation on it, and the version it reports are
// deliverables of this point (specs/instrumentation.md).
//
// THREE THINGS ARE DECIDED, IN THE ORDER A FAILURE MATTERS.
//
//   1. IT IS THERE. A build that never installed the global leaves nothing for
//      any check to reach the game through, and every other automated item in
//      this suite fails with it. The harness reports what it found as
//      `surfaceFault` rather than throwing, so the fault lands here as a verdict
//      instead of being buried in some other check's setup.
//   2. IT IS WHOLE. `REQUIRED_OPS` is the operation list of
//      `specs/instrumentation.md` under this engine, the two clock operations
//      included, so a build missing anything is named for exactly what it is
//      missing. `version` is `MELTDOWN_DEBUG_VERSION`.
//   3. IT IS LIVE. A surface whose operations all exist and whose snapshot
//      reports a plausible object unconnected to the running game is present and
//      useless. So a posed tower is read back, a posed unit is left to walk, and
//      the canvas is read before and after: the pose reached the state, the state
//      is what the simulation runs, and the state is what the renderer draws.
//
// THE KEYBOARD AND THE OVERLAY ARE NOT ON THE SURFACE. They belong to the
// runtime layer an engineless build writes, and `specs/instrumentation.md`
// carries no operation for either, so demanding one here would fail a perfectly
// conformant build. The control checks press real keys instead.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { MELTDOWN_DEBUG_VERSION } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  distance,
  failSurface,
  framesFor,
  HANDLE,
  poseTower,
  poseWalker,
  requireTower,
  requireUnit,
  REQUIRED_OPS,
  sampleFloor,
  sampleTower,
  startRun,
  type Harness,
} from "../harness";

/**
 * How far the posed Mote must have travelled over one second of game time, in
 * logical units.
 *
 * A Mote's own speed is `60` logical units per second (`specs/surge.md`), so a
 * live build covers about a tile and a half here. A quarter of a tile is the
 * floor: this point asks whether the simulation ran at all, and how fast it ran
 * is `surge/mote-speed`'s question, not this one.
 */
const MIN_TRAVEL = 5;

/**
 * How far the tower's drawn colour must sit from the bare floor's, on the 0-441
 * scale {@link colorDistance} measures.
 *
 * Nothing above zero: `specs/towers.md` fixes no palette, so the only honest
 * reading is that the renderer drew SOMETHING where the pose put a tower and the
 * bare floor is not it. Which colour is `presentation/*`'s business.
 */
const MIN_COLOR_MOVE = 0;

let h: Harness;

/**
 * Fail with the harness's own account of what is missing, paired with what the
 * specification requires, rather than with a comparison's rendering of it.
 *
 * `assertNull(h.surfaceFault)` would read as "Expected: null" over the reason,
 * throwing away the half of the pair that says what the build owes. This is the
 * point whose whole job is to name that plainly.
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
  requireSurface();

  const { version } = await h.probe([]);
  assertEqual(typeof version, "number", `window.${HANDLE}.version`);
});

it("carries the version and every required operation, as functions", async () => {
  requireSurface();
  const probed = await h.probe(REQUIRED_OPS);

  assertEqual(probed.version, MELTDOWN_DEBUG_VERSION, "MELTDOWN_DEBUG_VERSION");
  for (const op of REQUIRED_OPS) {
    assertEqual(probed.ops[op], "function", `window.${HANDLE}.${op}`);
  }
});

it("is wired to the running game it reports", async () => {
  requireSurface();
  await startRun(h);

  // The bare floor's colour FIRST, while it is still bare: the tower posed below
  // stands on one of the tiles that reading is taken over.
  const floor = await sampleFloor(h);

  const tower = await poseTower(h, "lance", FREE_SITE.col, FREE_SITE.row);
  const walker = await poseWalker(h, "mote", "left");
  const opened = await h.snapshot();
  const entered = requireUnit(opened, walker, "the posed Mote");

  await h.advance(framesFor(1));
  const driven = await h.snapshot();
  // The frame the readings below are taken off, so the picture and the surface's
  // account of it can be held against each other.
  await captureStill(h, "state");

  // The pose reached the state, and the state is what the surface reports.
  const placed = requireTower(driven, tower, "the posed Lance");
  assertEqual(placed.type, "lance", "the posed tower's type");
  assertEqual(placed.col, FREE_SITE.col, "the posed footprint's column");
  assertEqual(placed.row, FREE_SITE.row, "the posed footprint's row");

  // The state is what the simulation runs.
  assertGreaterThan(
    distance(entered, requireUnit(driven, walker, "the posed Mote")),
    MIN_TRAVEL,
    "the posed Mote walked over one second of game time",
  );

  // And the state is what the renderer draws.
  assertGreaterThan(
    colorDistance(await sampleTower(h, placed), floor),
    MIN_COLOR_MOVE,
    "the posed tower is drawn where the pose put it",
  );
});
