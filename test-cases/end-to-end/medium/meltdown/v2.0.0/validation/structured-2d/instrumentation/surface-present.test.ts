// Meltdown — instrumentation/surface-present: the debug surface is present and
// complete.
//
// `specs/instrumentation.md` makes the surface a DELIVERABLE: "Every operation
// this file specifies is a deliverable, and the game instance's `initialize`
// returns the finished surface. The engine holds it and returns it from
// `engine.debug`, and it is reached that way alone." It also fixes what the
// surface carries beside the operations — "`version` (`MELTDOWN_DEBUG_VERSION`,
// `1`), a plain number".
//
// THE OPERATION LIST IS THE CASE'S, NOT THE BUILD'S. `surface.ts` writes
// `specs/instrumentation.md`'s table of operations down as `REQUIRED_OPS`, so
// what a build is held to is the specification. `setAutoStep` and `advance` are
// deliberately NOT on it: the engine owns the clock under this engine and
// demanding either would fail a perfectly conformant build.
//
// AND A SURFACE THAT IS PRESENT CAN STILL BE USELESS. An operation that exists
// but arranges nothing, or a `snapshot` that returns a plausible-looking object
// unconnected to the running game, would pass a check that only counted members
// — and it is the failure mode worth naming, because it also shows up as every
// other suite in this directory failing to run. So the last check drives the
// surface and reads the game three ways: a posed tower comes back off the
// roster, a posed unit WALKS under the game's own rules, and the canvas the
// build draws into changes while it does.
//
// The three readings are deliberately of three different things — a roster
// entry, a simulated position, and the pixels — because a build could fake any
// one of them alone.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThan,
  assertNotNull,
} from "../assert";
import {
  canvasPixels,
  captureStill,
  createHarness,
  distance,
  pixelsChanged,
  positionOf,
  startRun,
  ticksFor,
  tileCenter,
  type Harness,
} from "../harness";
import { MELTDOWN_DEBUG_VERSION, REQUIRED_OPS } from "../surface";
import {
  OPEN_ROW,
  poseWalkerAt,
  QUIET_SITE,
  readTower,
  readUnit,
} from "./ground";

/** The heat the posed tower is read back at: a figure no default carries. */
const POSED_HEAT = 63;

/**
 * How far the tower's read-back heat may sit from the figure it was posed at.
 *
 * The read is taken with no frame advanced, so the heat model has not run and
 * the only thing between the pose and the reading is the surface itself. The
 * allowance is for a build that keeps its heat as a float and nothing else.
 */
const HEAT_TOLERANCE = 1e-9;

/** The game time the posed walker is given to move: one second. */
const WALK_SECONDS = 1;

/**
 * The least distance that second must carry the walker, in logical units.
 *
 * `specs/surge.md` gives the Mote `60` logical units per second, so a live
 * simulation moves it about three tiles. One unit is a twentieth of a tile: far
 * below anything a walking build produces, and far above the zero a surface that
 * poses nothing produces.
 */
const MIN_TRAVEL = 1;

/** The least number of canvas bytes a live render may differ by across the walk. */
const MIN_PIXELS_CHANGED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("is returned from initialize, carries version 1 and every operation", () => {
  // `engine.debug` is whatever the build's instance returned from `initialize`.
  // There is no page property to look for and nothing the harness could have
  // supplied in the build's place, so reading it IS the check.
  assertNotNull(h.engine.debug);
  assertEqual(typeof h.engine.debug, "object");

  const api = h.engine.debug as unknown as Record<string, unknown>;
  assertEqual(typeof api.version, "number", "version is a plain number");
  assertEqual(api.version, MELTDOWN_DEBUG_VERSION, "version");
  for (const op of REQUIRED_OPS) {
    assertEqual(typeof api[op], "function", `${op} is a function`);
  }
});

it("is live: a posed tower reads back, a posed unit walks, and the canvas changes", async () => {
  startRun(h);

  // A pose the game must actually hold: a tower on a named footprint, at a heat
  // no default carries.
  h.debug.addTower("arc", QUIET_SITE.col, QUIET_SITE.row, 0);
  const roster = h.snapshot().towers;
  assertEqual(roster.length, 1, "the towers addTower left on the floor");
  const towerId = roster[roster.length - 1].id;
  h.debug.setTowerHeat(towerId, POSED_HEAT);

  const posed = readTower(h.snapshot(), towerId, "the tower addTower built");
  assertEqual(posed.col, QUIET_SITE.col, "the posed tower's column");
  assertEqual(posed.row, QUIET_SITE.row, "the posed tower's row");
  assertLessThan(
    Math.abs(posed.heat - POSED_HEAT),
    HEAT_TOLERANCE,
    "the posed tower's heat, read back with no frame advanced",
  );

  // A pose the game's own rules must then RUN: a walker on an open row, left to
  // travel it under the build's own pathing and movement.
  const walkerId = poseWalkerAt(h, "mote", OPEN_ROW);
  const start = positionOf(
    readUnit(h.snapshot(), walkerId, "the unit addUnit released"),
  );
  assertEqual(
    Math.round(start.x),
    Math.round(tileCenter(OPEN_ROW.col, OPEN_ROW.row).x),
    "the walker starts where setUnitPosition put it",
  );

  const painted = canvasPixels(h);
  await h.advance(ticksFor(WALK_SECONDS));
  captureStill(h, "state");

  const walked = readUnit(
    h.snapshot(),
    walkerId,
    "the walker after a second of game time",
  );
  assertGreaterThan(
    distance(start, positionOf(walked)),
    MIN_TRAVEL,
    "the logical units the posed walker covered in a second",
  );
  assertGreaterThanOrEqual(
    pixelsChanged(painted, canvasPixels(h)),
    MIN_PIXELS_CHANGED,
    "the canvas bytes the build redrew while it walked",
  );
});
