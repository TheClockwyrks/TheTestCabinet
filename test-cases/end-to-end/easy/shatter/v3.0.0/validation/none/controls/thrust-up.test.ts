// Shatter — controls/thrust-up: `ArrowUp` thrusts, and releasing it stops the
// thrust.
//
// THE RULE. `specs/controls.md` binds `ArrowUp` to "Thrust" while the game is being
// played, and reads it as a HOLD: "the ship turns and accelerates for as long as the
// key is down and stops the moment it is released". `specs/ship.md` says what the
// hold does — "while the thrust key is held, an acceleration of `SHIP_THRUST` (`480`
// units per second squared) is added along the current facing" — and says the ship
// has no reverse thruster, so the acceleration goes ALONG the facing and never
// against it.
//
// THE KEY IS A REAL ONE. `holdFor` presses through Chromium's own input pipeline, so
// what reaches the build is a browser-trusted DOM key event on the real page rather
// than a synthetic one posed at whichever target a runtime happens to listen on.
// `specs/instrumentation.md` puts the keyboard in the runtime layer an engineless
// build supplies and gives the debug surface no keyboard operation at all, so the
// whole path — physical key, the build's own listener, the ship's thrust step — is
// the build's, and every step of it is exercised here.
//
// WHY THE READING IS THE COMPONENT ALONG THE FACING RATHER THAN THE SPEED. A build
// that answered `ArrowUp` with a shove in some fixed screen direction, or with a
// retro-thrust, would gain SPEED just as surely as a conformant one. The component
// along the facing the ship reports separates them: a conformant build puts the
// whole of the gain there and a build thrusting the other way puts a negative
// figure there. The facing is read back off the snapshot rather than assumed, so
// what is measured is acceleration along the facing the BUILD says it has.
//
// WHAT THIS ITEM DOES NOT DECIDE. How MUCH the ship gains — `flight/thrust-accelerates`
// holds a second of thrust to `SHIP_THRUST` less drag within five percent — nor how
// closely the gain lines up with the facing at four different facings, which is
// `flight/thrust-along-facing`. The floor below is half the drag-free ideal, which
// rules out a nudge and nothing else. The ship is posed at the safe point at rest
// facing `FACE_UP`, which is where `specs/ship.md` says a life begins, and the star
// never pulls the ship, so nothing but the key can put velocity on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { KEYS_THRUST, SHIP_THRUST, TICK_DT } from "../constants";
import { componentAlong, magnitude, unitAt } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  velocityOf,
  type Harness,
} from "../harness";

/** The key this item decides: the first of the two `specs/controls.md` binds thrust. */
const KEY = KEYS_THRUST[0];

/** The span the key is held for. */
const HOLD_SECONDS = 0.5;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

/**
 * The least speed along the facing that counts as having thrust at all.
 *
 * `SHIP_THRUST` (`480` units per second squared) held from rest for half a second is
 * `240` units per second before drag takes its share, and the `SHIP_DRAG_HALFLIFE`
 * (`3.0` seconds) `specs/ship.md` fixes leaves about `227` of it. HALF the drag-free
 * figure is the floor, so a build within the five percent `flight/thrust-accelerates`
 * allows clears it by nearly a factor of two and a build that merely nudged the ship
 * does not. The rate itself is that item's, not this one's.
 */
const THRUST_FLOOR = 0.5 * SHIP_THRUST * HOLD_SECONDS;

/** Ticks with nothing held after the key comes up. */
const COAST_TICKS = ticksFor(0.5);

/**
 * How much faster the ship may still be going after the key comes up.
 *
 * `specs/ship.md` adds the acceleration only "while the thrust key is held", and the
 * only other force on the ship is the drag, which can only take speed off — the star
 * never pulls the ship. So a released ship's speed does not rise at all, and the
 * whole of this allowance is the EDGE: the release lands between ticks, and a build
 * that reads its keyboard at the top of a tick may carry one more tick of thrust
 * than one that reads it at the bottom. Two ticks of `SHIP_THRUST` is `8` units per
 * second. A build that went on thrusting gains about `200` across the coast.
 *
 * It is stated as a ceiling on a RISE rather than as a required FALL on purpose:
 * requiring the drag's own fall here would fail a drag-less build twice, once here
 * and once at `flight/drag-halves-in-three-seconds`, for one fault.
 */
const STOPPED_TOL = 2 * SHIP_THRUST * TICK_DT;

/**
 * The facing the ship is posed on: across the field, along the positive `x` axis.
 *
 * NOT the `FACE_UP` a life begins on, and the reason is the STAR. The safe point
 * `specs/ship.md` puts a fresh ship at sits directly BELOW the star, so a ship
 * facing up thrusts straight into it — and `specs/collision.md` has the core stop a
 * ship that reaches it, sliding it out to `CORE_R + SHIP_R` (`44`) and taking the
 * inward half of its velocity away. A build that never stopped thrusting would then
 * be stopped by the STAR instead of read as still thrusting, and the environment,
 * not the key, would decide the item.
 *
 * Turned a quarter turn, the ship's whole course lies along `y = SAFE_Y` (`560`),
 * which is `200` units below the star's centre and therefore never within the `44`
 * the core acts at, whatever speed the ship reaches. `specs/field.md` wraps the
 * field on both axes, so the course never runs out either. Nothing else about the
 * pose moves: `specs/ship.md` adds the thrust along whatever facing the ship has.
 */
const FACE_ACROSS = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("accelerates the ship along its facing while ArrowUp is held, and stops on release", async () => {
  await startPlaying(h);
  await h.debug.setShipAngle(FACE_ACROSS);
  const posed = await h.snapshot();

  await h.holdFor(KEY, HOLD_TICKS);
  const thrust = await h.snapshot();
  await captureStill(h, "thrust");

  await h.advance(COAST_TICKS);
  const coasted = await h.snapshot();

  assertGreaterThan(
    componentAlong(velocityOf(thrust.ship), unitAt(posed.ship.angle)),
    THRUST_FLOOR,
    "the speed ArrowUp put along the ship's facing in half a second",
  );
  assertLessThanOrEqual(
    magnitude(velocityOf(coasted.ship)),
    magnitude(velocityOf(thrust.ship)) + STOPPED_TOL,
    "the ship's speed half a second after ArrowUp came up",
  );
});
