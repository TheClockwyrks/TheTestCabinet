// ship/clamp-left — the ship comes to rest ON `SHIP_X_MIN` and does not wrap.
//
// specs/ship.md, "Movement": the ship's "center `x` is clamped to
// `[SHIP_X_MIN, SHIP_X_MAX]` (`[40, 1240]`). A ship driven into a bound rests at
// that bound and does not wrap." specs/field.md carries the same lane. This point
// decides the LEFT bound; `ship/clamp-right` decides the other, so a build that
// clamped one end and not the other loses one point.
//
// THE SCENARIO IS THE REVIEW ITEM'S OWN: the ship is placed 120 units inside the
// bound and driven left until it can go no further. `setShipX` places the ship's
// centre along its lane (specs/instrumentation.md) and the placed point is well
// inside the lane, so nothing about the pose is itself clamped.
//
// ONE ASSERTION DECIDES BOTH HALVES OF THE RULE, because the three models the point
// separates read as three different numbers from the same reading. A build that
// clamps lands on `SHIP_X_MIN` (40); a build that WRAPS lands near `SHIP_X_MAX`
// (1240), twelve hundred units away; a build that clamps to the wrong figure — the
// stage's own left edge `FIELD_LEFT` (0), or the bound offset by the hull's
// half-extent `SHIP_HALF` (15) — lands 15 to 40 units away. The tolerance below
// admits none of them.
//
// THE HOLD IS LONG ENOUGH THAT THE SPEED IS NOT ON TRIAL. 120 units at `SHIP_SPEED`
// (`360`) is a third of a second, and the key is held for two seconds — six times
// over — so any build travelling faster than a sixth of the stated speed reaches the
// bound inside the window. A build slower than that loses `ship/move-left`, which is
// where a speed belongs; this point should not charge it a second time.
//
// THE WORLD IS EMPTY AND QUIET. `startPosed` clears the four rosters and shuts the
// wave's entry gate, its dive gate and the ship's contact test, so nothing arrives
// to cost a life and return the ship to the centre of its lane mid-scenario.

import { afterEach, beforeEach, it } from "vitest";
import { SHIP_X_MIN } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdActionFor,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** Where the ship starts: the review item's own 120 units inside the bound. */
const START_INSIDE = 120;
const START_X = SHIP_X_MIN + START_INSIDE;

/**
 * How far from `SHIP_X_MIN` the ship may come to rest, in logical units.
 *
 * The specification fixes the bound exactly, so this is float slack and nothing
 * else: a build integrating its travel a sub-step at a time (specs/simulation.md)
 * lands ON the bound the frame it crosses it. One unit is a fifteenth of the hull's
 * own half-extent `SHIP_HALF` (`15`), which is the nearest wrong figure a build
 * could clamp to.
 */
const CLAMP_TOLERANCE = 1;

/**
 * The frames the direction is held: two seconds.
 *
 * Six times the third of a second `START_INSIDE` takes at `SHIP_SPEED`, so the
 * bound is reached by any build travelling faster than a sixth of the stated speed
 * and the reading is of the REST rather than of the journey.
 */
const HELD_FRAMES = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("brings the ship to rest on SHIP_X_MIN without wrapping", async () => {
  startPosed(h);
  h.debug.setShipX(START_X);

  const before = h.snapshot();
  assertEqual(before.screen, "inWave", "the screen that reads the left action");
  assertEqual(
    before.phase,
    "live",
    "the ship is flying rather than respawning",
  );
  assertEqual(
    before.ship.x,
    START_X,
    `the ship placed ${String(START_INSIDE)} units inside SHIP_X_MIN, which is ` +
      "well within the lane and so is not itself clamped " +
      "(specs/instrumentation.md)",
  );

  await holdActionFor(h, "left", HELD_FRAMES);
  // Before the assertion, so a check that fails still leaves the picture of where
  // the ship came to rest.
  captureStill(h, "clamped");

  assertLessThanOrEqual(
    Math.abs(h.snapshot().ship.x - SHIP_X_MIN),
    CLAMP_TOLERANCE,
    `how far the ship's centre came to rest from SHIP_X_MIN ` +
      `(${String(SHIP_X_MIN)}) after ${String(HELD_FRAMES)} frames of held ` +
      `left from ${String(START_X)} — a ship driven into a bound rests at that ` +
      "bound and does not wrap, which would land it near SHIP_X_MAX " +
      "(specs/ship.md)",
  );
});
