// Spectra — ship/stops-on-release: the ship stops in the frame the direction is
// released.
//
// THE RULE. `specs/ship.md`: the ship "stops in the frame the direction is
// released, with no drift and no inertia". The review item states the reading:
// releasing the direction leaves the ship within one unit of where it stood a
// tenth of a second later.
//
// WHY BOTH DIRECTIONS ARE RELEASED. It is one requirement — that a released
// direction leaves NO residual motion — and a build carries its residue in a
// velocity, an easing or a smoothed input that a single direction cannot pin
// down: a ship that keeps a signed velocity drifts on after a left hold and on
// after a right one, while a ship that eases only toward a target x may look
// still after one and drift after the other. Both legs assert the same thing, and
// each names its own direction, so the failure says which release drifted.
//
// WHAT ONE UNIT IS, AND WHY IT IS THE RIGHT BOUND. `SHIP_SPEED` is 360 units a
// second, so the tenth of a second measured here covers 36 units of travel at
// speed. A build with real inertia — even a tenth of the ship's speed bled off
// over that window — moves several units; a build that stops dead moves none.
// One unit sits between the two by a wide margin in both directions, and it is
// the review item's own figure.
//
// THE MEASUREMENT TAKES NOTHING FROM THE HOLD. The reading is taken from where
// the ship stood at the RELEASE, not from where the hold started, so how far the
// hold carried it is `ship/move-left`'s and `ship/move-right`'s point and not
// this one's. The holds are short and start mid-lane, so neither leg reaches
// `SHIP_X_MIN` or `SHIP_X_MAX` and the clamp — which would stop a drifting ship
// for the wrong reason — never enters the scenario.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so nothing but the keys can move the ship, and nothing can drop it
// into the `ready` phase, where `specs/progression.md` re-centres it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { BINDINGS, FORM_CENTER_X, SHIP_SPEED } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPosed,
  type Harness,
} from "../harness";

/** The keys the two holds are delivered on, first of each binding. */
const LEFT_KEY = BINDINGS.left[0];
const RIGHT_KEY = BINDINGS.right[0];

/**
 * How long each direction is held before it is released.
 *
 * Long enough that a build carrying inertia has reached its full speed — 0.3 s is
 * 108 units of travel at `SHIP_SPEED` — and short enough that both legs stay well
 * inside `[SHIP_X_MIN, SHIP_X_MAX]` from the centre of the lane.
 */
const HOLD_FRAMES = framesFor(0.3);

/** The tenth of a second the review item measures the drift over. */
const SETTLE_SECONDS = 0.1;
const SETTLE_FRAMES = framesFor(SETTLE_SECONDS);

/**
 * The review item's bound on that drift: one unit.
 *
 * A thirty-sixth of the 36 units `SHIP_SPEED` covers in the same tenth of a
 * second, so it admits the floating-point residue of an integration that really
 * did stop and nothing that is still moving.
 */
const DRIFT_MAX = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the ship where the release left it, after either direction", async () => {
  await startPosed(h);
  const opening = await h.snapshot();
  assertEqual(
    opening.screen,
    "inWave",
    "the wave the keys are held in is live",
  );
  assertEqual(
    opening.phase,
    "live",
    "and the ship is flying rather than respawning",
  );
  assertEqual(opening.ship.x, FORM_CENTER_X, "the ship starts mid-lane");

  await h.holdFor(LEFT_KEY, HOLD_FRAMES);
  const leftReleased = (await h.snapshot()).ship.x;
  await h.advance(SETTLE_FRAMES);
  const leftSettled = (await h.snapshot()).ship.x;

  assertLessThanOrEqual(
    Math.abs(leftSettled - leftReleased),
    DRIFT_MAX,
    `the units the ship drifted in the ${SETTLE_SECONDS}s after LEFT was released, where holding it covers ${SHIP_SPEED} units a second (specs/ship.md)`,
  );

  await h.holdFor(RIGHT_KEY, HOLD_FRAMES);
  const rightReleased = (await h.snapshot()).ship.x;
  await h.advance(SETTLE_FRAMES);
  await captureStill(h, "stopped");
  const rightSettled = (await h.snapshot()).ship.x;

  assertLessThanOrEqual(
    Math.abs(rightSettled - rightReleased),
    DRIFT_MAX,
    `the units the ship drifted in the ${SETTLE_SECONDS}s after RIGHT was released, where holding it covers ${SHIP_SPEED} units a second (specs/ship.md)`,
  );
});
