// instrumentation/surface-present — the build returned its debug and automation
// surface from initialize, the surface is whole, and it is really wired to the
// running game.
//
// THE RULE. `specs/instrumentation.md`: "You implement it. Every operation this
// file specifies is a deliverable, and the game instance's `initialize` returns
// the finished surface. The engine holds it and returns it from `engine.debug`,
// and it is reached that way alone." The surface carries `version`
// (`SHATTER_DEBUG_VERSION`, `1`) and the operations of The operations.
//
// THREE THINGS ARE DECIDED, AND ALL THREE ARE THE BUILD'S.
//
// PRESENT. `engine.debug` is whatever the build's instance returned, so reading
// it is the whole check: there is no page property to look for
// (`specs/instrumentation.md`: "nothing is installed on the page") and nothing
// the harness could have supplied in its place. A build whose `initialize`
// returned nothing never gets this far, because the engine rejects `initialize`
// itself and the failure lands in `beforeEach` with the engine's own message.
//
// COMPLETE. The version and every operation `surface.ts` lists — the case's own
// declaration of the specification, never the build's. The clock, the keyboard,
// the audio bus and the overlay are the engine's under this engine, so the
// surface carries no operation for any of them: `setAutoStep` and `advance`
// belong to the engineless build alone and demanding either here would fail a
// perfectly conformant build. There is no `setMuted` under any engine.
//
// LIVE. An operation that exists but arranges nothing the frames that follow
// honour is a surface that is present and useless. So a rock is posed with a
// velocity, read back at the call, and then the game is advanced and the rock
// is found where the pose put it plus the travel that velocity is worth. The
// well is the only other thing acting on it, and its contribution over the
// stretch is derived below rather than assumed away.
//
// Every other item in this suite drives this surface to pose its own scenario,
// so a missing surface or an operation that does not act also shows up as those
// items failing. This one names the fault plainly.
//
// WHAT IS NOT DEMANDED. `REQUIRED_OPS` is the list `specs/instrumentation.md`
// states for EVERY variant. The torpedo operations and `setRockHealth` are stated
// under `warhead` alone, so a `base` build is correct to carry none of them and
// this point never asks for one; the four `warhead` instrumentation items and the
// `armor` and `torpedo` groups are what decide those, and each of them names the
// operation it could not reach.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDoesNotThrow,
  assertEqual,
  assertLessThanOrEqual,
  assertNotNull,
} from "../assert";
import { QUIET_CORNER } from "../fixtures";
import { driftOver } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { READINGS, REQUIRED_OPS, SHATTER_DEBUG_VERSION } from "../surface";

/** The course the posed rock is put on, in units per second. */
const POSED_VX = 100;
const POSED_VY = 0;

/** How long the rock is left to run, in seconds of game time. */
const DRIFT_SECONDS = 0.5;

/** Where the posed velocity alone would carry the rock over the stretch. */
const DRIFT_END = {
  x: QUIET_CORNER.x + POSED_VX * DRIFT_SECONDS,
  y: QUIET_CORNER.y + POSED_VY * DRIFT_SECONDS,
};

/**
 * How far the rock's reported centre may sit from where its posed velocity
 * alone would carry it, in units.
 *
 * The well is the one other thing acting on it (`specs/gravity.md`), and the
 * rock is posed on the quiet ground for exactly that reason. `driftOver`
 * answers what the well adds to a pulled body's SPEED over a stretch, from the
 * same law `specs/gravity.md` fixes; a body starting at rest under that
 * acceleration covers at most half of it times the stretch, which is the whole
 * of the gap between "carried by the pose" and "carried by the pose and the
 * well". The stronger of the pulls at the two ends of the stretch is the one
 * taken, since the rock closes on the star as it goes, and one unit is added
 * for the tick-by-tick integration the game runs it as.
 */
const DRIFT_TOLERANCE =
  (Math.max(
    driftOver(QUIET_CORNER, DRIFT_SECONDS),
    driftOver(DRIFT_END, DRIFT_SECONDS),
  ) *
    DRIFT_SECONDS) /
    2 +
  1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns its debug surface from initialize", () => {
  assertDoesNotThrow(() => h.engine.debug);
  assertNotNull(h.engine.debug);

  // The engine hands back the value the instance returned, unchanged and
  // unwrapped, so every read is the same object. It is the one every check in
  // this project poses the game through.
  assertEqual(typeof h.engine.debug, "object");
  assertEqual(h.engine.debug, h.engine.debug);
});

it("carries the specified version and every specified operation, as functions", () => {
  const api = h.engine.debug as unknown as Record<string, unknown>;

  assertEqual(typeof api.version, "number", "version is a plain number");
  assertEqual(
    api.version,
    SHATTER_DEBUG_VERSION,
    "version is SHATTER_DEBUG_VERSION (specs/instrumentation.md)",
  );
  for (const op of REQUIRED_OPS) {
    assertEqual(
      typeof api[op],
      "function",
      `the ${op} operation (specs/instrumentation.md)`,
    );
  }
});

it("reads the running game: two snapshots with no frame between them agree", () => {
  // A reading returns plain data built at the call and changes nothing
  // (specs/instrumentation.md), so reading twice with nothing advanced between
  // them reports the same game.
  for (const reading of READINGS) {
    assertEqual(
      typeof (h.engine.debug as unknown as Record<string, unknown>)[reading],
      "function",
      `the ${reading} reading`,
    );
  }

  const first = h.snapshot();
  assertEqual(typeof first, "object", "snapshot() returns an object");
  assertEqual(
    first.version,
    SHATTER_DEBUG_VERSION,
    "the snapshot reports the surface's version",
  );
  assertEqual(
    h.snapshot().simTime,
    first.simTime,
    "a reading changes nothing: simTime is the same across two reads",
  );
});

it("is live: a posed rock reads back and drifts when the game is advanced", async () => {
  startPlaying(h);
  const id = poseRock(
    h,
    "large",
    QUIET_CORNER.x,
    QUIET_CORNER.y,
    POSED_VX,
    POSED_VY,
  );

  // Read back at the call: a pose acts on the live game the moment it is made,
  // so no frame stands between the arrangement and the reading of it.
  const posed = requireRock(h.snapshot(), id, "the rock addRock appended");
  assertEqual(posed.x, QUIET_CORNER.x, "the posed rock's x");
  assertEqual(posed.y, QUIET_CORNER.y, "the posed rock's y");
  assertEqual(posed.vx, POSED_VX, "the posed rock's vx");
  assertEqual(posed.vy, POSED_VY, "the posed rock's vy");

  // And it really is on the field the game runs: advanced, it has travelled
  // what its velocity is worth, give or take the well.
  await h.advance(ticksFor(DRIFT_SECONDS));
  captureStill(h, "surface");

  const drifted = requireRock(
    h.snapshot(),
    id,
    "the posed rock after half a second of game time",
  );
  assertLessThanOrEqual(
    Math.abs(drifted.x - DRIFT_END.x),
    DRIFT_TOLERANCE,
    "the posed rock's x after the travel its posed velocity is worth",
  );
  assertLessThanOrEqual(
    Math.abs(drifted.y - DRIFT_END.y),
    DRIFT_TOLERANCE,
    "the posed rock's y after the travel its posed velocity is worth",
  );
});
