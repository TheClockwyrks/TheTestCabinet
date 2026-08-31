// controls/thrust-w — `KeyW` thrusts.
//
// THE RULE. `specs/controls.md`'s binding table gives the `up` action two keys,
// `ArrowUp` and `KeyW`, so `KeyW` is the WASD half of the thrust rather than a
// second, lesser binding; `up` means "Thrust" while the game is being played.
// `specs/ship.md` says what the hold does: "while the thrust key is held, an
// acceleration of `SHIP_THRUST` (`480` units per second squared) is added along the
// current facing", and the ship has no reverse thruster.
//
// WHY IT IS A SEPARATE ITEM FROM `controls/thrust-up`. The two keys are one row of
// the binding table, and under this engine one registration — but a build registers
// the action itself, and the commonest way to lose one is to hand the engine the
// arrows and forget the letters. This item drives `KeyW` and nothing else, so a
// build with a working `ArrowUp` and a dead `KeyW` loses exactly this point.
//
// `KeyW` CARRIES A SECOND MEANING, AND THIS IS THE PLAYING ONE. The same key moves
// a menu selection up (`controls/menu-w`) through the same `up` action, and
// `specs/controls.md` says the screen decides which meaning applies. The ship is
// posed on `playing`, so what the action must do here is thrust.
//
// THE KEY IS A REAL ONE. `holdFor` dispatches a `KeyboardEvent`-shaped event at the
// event target the engine listens on, which the engine's input contract states
// drives an action exactly as a player's key does — and it is delivered by its
// `code`, which is what makes `KeyW` the PHYSICAL key rather than the character a
// layout happens to put there, exactly as `specs/controls.md` states.
//
// WHAT THIS ITEM DOES NOT DECIDE. How much the ship gains, which is
// `flight/thrust-accelerates`; how closely the gain lines up with the facing at
// four facings, which is `flight/thrust-along-facing`; and whether the thrust stops
// on release, which the item's description leaves to `controls/thrust-up`.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_THRUST } from "../../src/constants";
import { assertContains, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { alongFacing, holdFor } from "./drive";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "KeyW";
const ACTION = "up";

/** The span the key is held for, the same span the arrow item uses. */
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
 * build that merely nudged the ship does not.
 */
const THRUST_FLOOR = 0.5 * SHIP_THRUST * HOLD_SECONDS;

/**
 * The facing the ship is posed on: across the field, along the positive `x` axis.
 *
 * NOT the `FACE_UP` a life begins on, and the reason is the STAR. The safe point
 * `specs/ship.md` puts a fresh ship at sits directly BELOW the star, so a ship
 * facing up thrusts straight into it — and `specs/collision.md` has the core stop a
 * ship that reaches it, sliding it out to `CORE_R + SHIP_R` (`44`) and taking away
 * the component of its velocity heading in, which would let the environment rather
 * than the key decide what the ship's velocity reads.
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

it("accelerates the ship along its facing while KeyW is held", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `up` action to",
  );

  startPlaying(h);
  h.debug.setShipAngle(FACE_ACROSS);
  const posed = h.snapshot();

  await holdFor(h, KEY, HOLD_TICKS);
  const thrust = h.snapshot();
  captureStill(h, "thrust");

  assertGreaterThan(
    alongFacing(thrust.ship, posed.ship.angle),
    THRUST_FLOOR,
    "the speed KeyW put along the ship's facing in half a second",
  );
});
