// Spectra — ship/clamp-left: a ship driven into the left bound rests on it.
//
// THE RULE. `specs/ship.md` and `specs/field.md`: the ship's "center `x` is
// clamped to `[SHIP_X_MIN, SHIP_X_MAX]` (`[40, 1240]`). A ship driven into a
// bound rests at that bound and does not wrap." The review item fixes the
// scenario: held left from 120 units inside `SHIP_X_MIN`, the ship comes to rest
// AT `SHIP_X_MIN` and does not wrap. `ship/clamp-right` decides the other bound,
// so a build that clamped one end and not the other loses exactly one point.
//
// THE TWO WRONG MODELS THIS SCENARIO TELLS APART. A ship that wraps leaves the
// left edge and reappears near `SHIP_X_MAX`, 1200 units the other way; a ship
// with no bound at all keeps going and ends far NEGATIVE; a ship that clamps the
// hull's edge rather than its centre rests at `SHIP_W / 2` (20) instead of 40.
// Each of the three reads as a different number, so the failure names which model
// the build implemented rather than only that something is wrong.
//
// WHY THE HOLD IS AS LONG AS IT IS. 120 units is a third of a second at
// `SHIP_SPEED` (360). The hold runs a full second — three times over — so a build
// travelling at any plausible fraction of the stated rate still reaches the bound
// and is graded on where it comes to rest rather than on how fast it got there.
// The rate is `ship/move-left`'s point; a hold sized to only just arrive would be
// grading it here too.
//
// WHERE THE SHIP STARTS. `setShipX` places the ship's centre along its lane and
// the lane's own clamp applies, so 160 (`SHIP_X_MIN + 120`) is posed exactly. The
// pose is read back before the hold, so a surface that placed the ship somewhere
// else fails here rather than quietly changing what is measured.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so nothing arrives, nothing dives and no contact drops the ship
// into the `ready` phase — where `specs/progression.md` would re-centre it, and a
// ship at the centre of its lane is neither clamped nor wrapped.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLessThanOrEqual } from "../assert";
import { BINDINGS, SHIP_SPEED, SHIP_X_MIN } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/** The key the hold is delivered on: the first `specs/controls.md` binds to `left`. */
const LEFT_KEY = BINDINGS.left[0];

/** Where the ship starts: the review item's 120 units inside the bound. */
const START_INSIDE = 120;
const START_X = SHIP_X_MIN + START_INSIDE;

/** How long left is held: three times the 1/3 s the 120 units need at SHIP_SPEED. */
const HOLD_FRAMES = framesFor(1);

/**
 * How far from `SHIP_X_MIN` the ship may come to rest: half a unit.
 *
 * "Rests AT that bound" is an equality, and this is the room a floating-point
 * integration needs around one rather than a tolerance on the figure. For scale:
 * one frame of this harness's 100 Hz clock carries the ship 3.6 units at
 * `SHIP_SPEED`, and one sub-step of `SUBSTEP_MAX` carries it 3, so a build that
 * merely STOPS SHORT — refusing the step that would cross the bound instead of
 * clamping to it — rests at least three units away and fails, while a build that
 * clamps arrives exactly.
 */
const REST_TOLERANCE = 0.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("comes to rest on SHIP_X_MIN and does not wrap", async () => {
  await startPosed(h);
  await h.debug.setShipX(START_X);
  const before = await h.snapshot();
  assertEqual(before.screen, "inWave", "the wave the key is held in is live");
  assertEqual(
    before.ship.x,
    START_X,
    `the ship starts ${START_INSIDE} units inside SHIP_X_MIN (${SHIP_X_MIN})`,
  );

  await h.holdFor(LEFT_KEY, HOLD_FRAMES);
  await captureStill(h, "clamped");
  const after = await h.snapshot();

  assertLessThanOrEqual(
    after.ship.x,
    START_X,
    `the ship's centre after a second held LEFT — a ship that WRAPPED off the left edge reappears near SHIP_X_MAX and reads far above this (specs/field.md)`,
  );
  assertBetween(
    after.ship.x,
    SHIP_X_MIN - REST_TOLERANCE,
    SHIP_X_MIN + REST_TOLERANCE,
    `the ship's centre at rest on the left bound, SHIP_X_MIN (${SHIP_X_MIN}), after being driven into it at SHIP_SPEED (${SHIP_SPEED}) (specs/field.md)`,
  );
});
