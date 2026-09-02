// controls/thrust-up — `ArrowUp` thrusts, and releasing it stops the thrust.
//
// THE RULE. `specs/controls.md` binds `ArrowUp` to the `up` action and gives `up`
// the meaning "Thrust" while the game is being played, and reads it as a HOLD: "the
// ship turns and accelerates for as long as the key is down and stops the moment it
// is released". `specs/ship.md` says what the hold does — "while the thrust key is
// held, an acceleration of `SHIP_THRUST` (`480` units per second squared) is added
// along the current facing" — and says the ship has no reverse thruster, so the
// acceleration goes ALONG the facing and never against it.
//
// THE KEY IS A REAL ONE. The hold dispatches a `KeyboardEvent`-shaped event at the
// very event target the engine attached its own `keydown` and `keyup` listeners to,
// which the engine's input contract states drives an action exactly as a player's
// key does. Under this engine `specs/controls.md` puts the keyboard on the engine's
// side of the line — input reaches the game as named actions — so what this item
// grades is the build's two halves of that path: that it REGISTERED the action
// against the keys `BINDINGS` gives it ("the whole of `ACTIONS` is registered"), and
// that it READS that action on this screen and thrusts by it.
// `specs/instrumentation.md` gives the debug surface no keyboard operation at all,
// so there is no shorter route.
//
// `ArrowUp` CARRIES A SECOND MEANING, AND THIS IS THE PLAYING ONE. The same key
// moves a menu selection up (`controls/menu-up-arrow`) through the same `up`
// action, and `specs/controls.md` gives the two meanings in two columns of one
// table, the screen deciding which applies. The ship is posed on `playing`, so what
// the action must do here is thrust.
//
// WHY THE READING IS THE COMPONENT ALONG THE FACING RATHER THAN THE SPEED. A build
// that answered `ArrowUp` with a shove in some fixed screen direction, or with a
// retro-thrust, would gain SPEED just as surely as a conformant one. The component
// along the facing the ship reports separates them: a conformant build puts the
// whole of the gain there and a build thrusting the other way puts a negative
// figure there. The facing is read back off the snapshot rather than assumed, so
// what is measured is acceleration along the facing the BUILD says it has.
//
// WHAT THIS ITEM DOES NOT DECIDE. How MUCH the ship gains —
// `flight/thrust-accelerates` holds a second of thrust to `SHIP_THRUST` less drag
// within five percent — nor how closely the gain lines up with the facing at four
// different facings, which is `flight/thrust-along-facing`. The floor below is half
// the drag-free ideal, which rules out a nudge and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_THRUST, TICK_DT } from "../../src/constants";
import {
  assertContains,
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { speedOf } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { alongFacing } from "./drive";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "ArrowUp";
const ACTION = "up";

/** The span the key is held for. */
const HOLD_SECONDS = 0.5;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

/**
 * The least speed along the facing that counts as having thrust at all.
 *
 * `SHIP_THRUST` (`480` units per second squared) held from rest for half a second
 * is `240` units per second before drag takes its share, and the
 * `SHIP_DRAG_HALFLIFE` (`3.0` seconds) `specs/ship.md` fixes leaves about `227` of
 * it. HALF the drag-free figure is the floor, so a build within the five percent
 * `flight/thrust-accelerates` allows clears it by nearly a factor of two and a
 * build that merely nudged the ship does not. The rate itself is that item's, not
 * this one's.
 */
const THRUST_FLOOR = 0.5 * SHIP_THRUST * HOLD_SECONDS;

/** The quiet stretch driven before the key goes down, in ticks. */
const LEAD_TICKS = ticksFor(0.25);

/**
 * The speed a ship posed at rest may report over that quiet stretch, in units per
 * second.
 *
 * `startPlaying` leaves the velocity at exactly `(0, 0)`, and `specs/ship.md`
 * leaves nothing but thrust able to add to it — drag multiplies, and the star
 * never pulls the ship — so a ship with no thrust key down stays at exactly rest.
 * A hundredth of a unit per second is the allowance for a build that carries its
 * velocity through a rounding of its own.
 *
 * WHY THE LEAD IS READ AT ALL. Without it, a build that accelerates the ship of
 * its own accord and never binds this key satisfies the burn below: the speed
 * along the facing has the required size for reasons that have nothing to do with
 * ArrowUp.
 */
const AT_REST = 0.01;

/** Ticks with nothing held after the key comes up. */
const COAST_TICKS = ticksFor(0.5);

/**
 * How much faster the ship may still be going after the key comes up.
 *
 * `specs/ship.md` adds the acceleration only "while the thrust key is held", and
 * the only other force on the ship is the drag, which can only take speed off — the
 * star never pulls the ship. So a released ship's speed does not rise at all, and
 * the whole of this allowance is the EDGE: the release lands between ticks, and a
 * build that reads the action at the top of a tick may carry one more tick of
 * thrust than one that reads it at the bottom. Two ticks of `SHIP_THRUST` is `8`
 * units per second. A build that went on thrusting gains about `200` across the
 * coast.
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
 * ship that reaches it, sliding it out to `CORE_R + SHIP_R` (`44`) and taking away
 * the component of its velocity heading in. A build that never stopped thrusting
 * would then be stopped by the STAR instead of read as still thrusting, and the
 * environment, not the key, would decide the item.
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

afterEach(() => {
  h?.dispose();
});

it("accelerates the ship along its facing while ArrowUp is held, and stops on release", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `up` action to",
  );

  startPlaying(h);
  h.debug.setShipAngle(FACE_ACROSS);
  const posed = h.snapshot();

  await h.advance(LEAD_TICKS);
  const led = h.snapshot();

  h.hold(KEY);
  const thrust = await (async () => {
    try {
      await h.advance(HOLD_TICKS);
      return h.snapshot();
    } finally {
      h.release(KEY);
    }
  })();
  captureStill(h, "thrust");

  await h.advance(COAST_TICKS);
  const coasted = h.snapshot();

  assertLessThanOrEqual(
    speedOf(led.ship),
    AT_REST,
    `the ship's speed in units per second after ${String(LEAD_TICKS)} ticks ` +
      `with no key down, before the hold — a ship posed at rest stays at rest ` +
      `(specs/ship.md)`,
  );
  assertEqual(
    led.ship.thrusting,
    false,
    `whether the build reported thrust on the tick before ${KEY} went down — ` +
      `thrust is applied only while the key is held (specs/controls.md)`,
  );
  assertGreaterThan(
    alongFacing(thrust.ship, posed.ship.angle),
    THRUST_FLOOR,
    "the speed ArrowUp put along the ship's facing in half a second",
  );
  assertLessThanOrEqual(
    speedOf(coasted.ship),
    speedOf(thrust.ship) + STOPPED_TOL,
    "the ship's speed half a second after ArrowUp came up",
  );
  assertEqual(
    thrust.ship.thrusting,
    true,
    `the build's own thrusting flag on the last tick of the ${KEY} hold — ` +
      `thrust is applied for as long as the key is down (specs/controls.md), ` +
      `and specs/ui.md keys the drawn flame and the held cue off this field`,
  );
});
