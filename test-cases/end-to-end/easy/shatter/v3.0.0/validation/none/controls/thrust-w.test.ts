// Shatter — controls/thrust-w: `KeyW` thrusts.
//
// THE RULE. `specs/controls.md` puts `ArrowUp` and `KeyW` on the same row of its key
// table, "Thrust", so `KeyW` is the WASD half of the thrust rather than a second,
// lesser binding. `specs/ship.md` says what the hold does: "while the thrust key is
// held, an acceleration of `SHIP_THRUST` (`480` units per second squared) is added
// along the current facing", and the ship has no reverse thruster.
//
// WHY IT IS A SEPARATE ITEM FROM `controls/thrust-up`. The two keys are one row of
// the table but two listeners in a build, and the commonest way to lose one is to
// wire the arrows and forget the letters. This item drives `KeyW` and nothing else,
// so a build with a working `ArrowUp` and a dead `KeyW` loses exactly this point.
//
// `KeyW` CARRIES A SECOND MEANING, AND THIS IS THE PLAYING ONE. The same key moves a
// menu selection up (`controls/menu-w`), and `specs/controls.md` says the screen
// decides which meaning applies. The ship is posed on `playing`, so what the key
// must do here is thrust.
//
// THE KEY IS A REAL ONE. `holdFor` presses through Chromium's own input pipeline, so
// what reaches the build is a browser-trusted DOM key event delivered by its `code` —
// which is what makes `KeyW` the PHYSICAL key rather than the character a layout
// happens to put there, exactly as `specs/controls.md` states.
//
// WHAT THIS ITEM DOES NOT DECIDE. How much the ship gains, which is
// `flight/thrust-accelerates`; how closely the gain lines up with the facing at four
// facings, which is `flight/thrust-along-facing`; and whether the thrust stops on
// release, which the item's description leaves to `controls/thrust-up`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { KEYS_THRUST, SHIP_THRUST } from "../constants";
import { componentAlong, magnitude, unitAt } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  velocityOf,
  type Harness,
} from "../harness";

/** The key this item decides: the second of the two `specs/controls.md` binds thrust. */
const KEY = KEYS_THRUST[1];

/** The span the key is held for, the same span the arrow item uses. */
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
 * does not.
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
 * KeyW.
 */
const AT_REST = 0.01;

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

it("accelerates the ship along its facing while KeyW is held", async () => {
  await startPlaying(h);
  await h.debug.setShipAngle(FACE_ACROSS);
  const posed = await h.snapshot();

  await h.advance(LEAD_TICKS);
  const led = await h.snapshot();

  await h.hold(KEY);
  const thrust = await (async () => {
    try {
      await h.advance(HOLD_TICKS);
      return await h.snapshot();
    } finally {
      await h.release(KEY);
    }
  })();
  await captureStill(h, "thrust");

  assertLessThanOrEqual(
    magnitude(velocityOf(led.ship)),
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
    componentAlong(velocityOf(thrust.ship), unitAt(posed.ship.angle)),
    THRUST_FLOOR,
    "the speed KeyW put along the ship's facing in half a second",
  );
  assertEqual(
    thrust.ship.thrusting,
    true,
    `the build's own thrusting flag on the last tick of the ${KEY} hold — ` +
      `thrust is applied for as long as the key is down (specs/controls.md), ` +
      `and specs/ui.md keys the drawn flame and the held cue off this field`,
  );
});
