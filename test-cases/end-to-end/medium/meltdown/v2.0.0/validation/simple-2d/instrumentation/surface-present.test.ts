// Meltdown — instrumentation/surface-present: the debug and automation surface is
// present, whole, and live.
//
// specs/instrumentation.md makes the surface a deliverable of the build: its
// `initialize` returns the finished surface beside the state, as `[state, debug]`,
// the engine returns that same value from `engine.debug`, and it is reached that
// way alone — nothing is installed on the page. Every other suite on this
// checklist poses its scenario through it, so a missing surface also shows up as
// every other suite failing to run; this one names the fault plainly.
//
// TWO HALVES, AND BOTH ARE THE BUILD'S.
//
// PRESENCE. `version` is `MELTDOWN_DEBUG_VERSION` (`1`), a plain number, and
// every operation the specification names for an engine build is a function on
// the surface. The table read is `REQUIRED_OPS` in `validation/surface.ts`, which
// is the specification's own list in the specification's own order — never the
// build's idea of what it wrote, which is why the surface is read as a bag of
// members rather than through the case's types. `setAutoStep` and `advance` are
// NOT demanded and must not be: under an engine the clock is the engine's, and
// specs/instrumentation.md gives those two operations to the engineless build
// alone.
//
// LIVENESS is the failure mode worth naming on its own: a surface that reports a
// plausible-looking object unconnected to the running game. Three readbacks have
// to move together, and each is a different connection:
//
//   - the STATE the surface reads: a tower posed with `addTower` is reported by
//     `snapshot`, on the footprint it was posed on;
//   - the SIMULATION the state feeds: a unit posed walking travels over a second
//     of game time, which only the game's own pathing and locomotion can do;
//   - the CANVAS the simulation is drawn to: the rendered frame after the poses
//     differs from the frame before them.
//
// The travel bound is deliberately far below a Mote's specified speed. This point
// decides that the surface is WIRED TO THE GAME, not how fast a Mote walks —
// `surge` and `mazing` decide that — so anything a build could reach only by
// running its own locomotion is enough here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotNull } from "../assert";
import { TILE } from "../../src/constants";
import {
  captureStill,
  createHarness,
  lastTower,
  poseTower,
  startRun,
  ticksFor,
  unitOf,
  type Harness,
} from "../harness";
import { MELTDOWN_DEBUG_VERSION, REQUIRED_OPS } from "../surface";
import { GUN, WALK, poseWalkerOn } from "./scenes";

/** The window the posed walker is watched over: one second of game time. */
const WALK_TICKS = ticksFor(1);

/**
 * How far the posed walker must travel over that second, in logical units.
 *
 * One tile. A Mote's specified speed is `60` logical units per second
 * (specs/surge.md), which is `3.16` tiles, so this is under a third of it: the
 * bound is here to separate a game that is RUNNING from one that is not, and a
 * build whose Mote walks at less than a third of its specified speed is failed by
 * `surge`'s own speed item rather than by this one.
 */
const MOVING_MIN = TILE;

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
  assertNotNull(h.engine.debug, "initialize returns [state, debug]");
  assertEqual(typeof h.engine.debug, "object", "the surface is an object");
});

it("carries the version and every specified operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  assertEqual(typeof api.version, "number", "version is a plain number");
  assertEqual(api.version, MELTDOWN_DEBUG_VERSION, "MELTDOWN_DEBUG_VERSION");
  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof api[op],
      "function",
      `specs/instrumentation.md names ${op} as an operation of the surface`,
    );
  }
});

it("is live: a posed tower reads back, a posed unit walks, and the canvas changes", async () => {
  startRun(h);
  await h.advance(1);
  const before = h.ctx.getImageData(0, 0, h.canvas.width, h.canvas.height);

  // The STATE: a tower posed through the surface is the tower the surface
  // reports, on the footprint it was posed on and as the type it was posed as.
  const gun = poseTower(h, "arc", GUN.col, GUN.row);
  const posed = lastTower(h.snapshot());
  assertEqual(posed.id, gun, "the posed tower is the roster's last entry");
  assertEqual(posed.type, "arc", "the posed tower's type");
  assertEqual(posed.col, GUN.col, "the posed tower's footprint column");
  assertEqual(posed.row, GUN.row, "the posed tower's footprint row");

  // The SIMULATION: a unit posed walking covers ground over a second of game
  // time, which nothing but the game's own pathing and locomotion produces.
  const walker = poseWalkerOn(h, "mote", WALK.col, WALK.row);
  await h.advance(1);
  const opened = unitOf(h.snapshot(), walker);
  await h.advance(WALK_TICKS);
  const closed = unitOf(h.snapshot(), walker);
  captureStill(h, "state");
  assertGreaterThan(
    Math.hypot(closed.x - opened.x, closed.y - opened.y),
    MOVING_MIN,
    "logical units a posed Mote travels over a second of game time",
  );

  // The CANVAS: the frame drawn after the poses is not the frame drawn before
  // them, so the surface drives the game that is actually rendering.
  const after = h.ctx.getImageData(0, 0, h.canvas.width, h.canvas.height);
  let changed = 0;
  for (let i = 0; i < after.data.length; i += 1) {
    if (after.data[i] !== before.data[i]) changed += 1;
  }
  assertGreaterThan(
    changed,
    0,
    "device-pixel channels the posed floor changed on the canvas",
  );
});
