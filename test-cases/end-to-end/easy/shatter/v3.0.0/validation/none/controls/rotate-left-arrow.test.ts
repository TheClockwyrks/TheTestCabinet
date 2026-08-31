// Shatter — controls/rotate-left-arrow: `ArrowLeft` turns the ship
// counter-clockwise, and releasing it stops the turn.
//
// THE RULE. `specs/controls.md` binds `ArrowLeft` to "Rotate counter-clockwise"
// while the game is being played, and reads rotation as a HOLD: "the ship turns and
// accelerates for as long as the key is down and stops the moment it is released".
// `specs/ship.md` fixes which way that is — "the left key turns counter-clockwise" —
// and `specs/overview.md` fixes the sign it reads as, quoting angles clockwise from
// the positive `x` axis on a field whose `y` runs downward, so a counter-clockwise
// turn DECREASES the facing.
//
// THE KEY IS A REAL ONE. `hold` and `release` press through Chromium's own input
// pipeline, so what reaches the build is a browser-trusted DOM key event on the real
// page rather than a synthetic one posed at whichever target a runtime happens to
// listen on. `specs/instrumentation.md` puts the keyboard in the runtime layer an
// engineless build supplies and gives the debug surface no keyboard operation at
// all, so the whole path — physical key, the build's own listener, the ship's
// rotation step — is the build's, and every step of it is exercised here. There is
// no shorter route to this item: a facing posed with `setShipAngle` would grade the
// pose rather than the key.
//
// WHAT THIS ITEM DOES NOT DECIDE. The RATE. How fast a held key turns the ship is
// `flight/turn-rate-left`, which holds it to `SHIP_TURN` within three percent;
// asserting it here as well would cost one build two points for one fault. The floor
// below is therefore a quarter of the stated turn, which rules out a facing that
// moved by rounding noise and nothing else. Nor does it decide that rotation leaves
// the VELOCITY alone — that is `flight/rotation-keeps-velocity` — so the ship is
// posed at rest and no other faculty is touched.
//
// THE WORLD IS EMPTY. `startPlaying` clears every roster, shuts both world gates and
// the ship's contact gate, and puts the ship at the safe point at rest facing
// `FACE_UP`. Nothing else is on the field to turn, hit or spawn, so the only thing
// that can move the facing across the drive is the key this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan, assertLessThanOrEqual } from "../assert";
import { KEYS_LEFT, SHIP_TURN, TICK_DT } from "../constants";
import { angleBetween } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldTurn } from "./turn";

/** The key this item decides: the first of the two `specs/controls.md` binds left. */
const KEY = KEYS_LEFT[0];

/** The second the key is held for, as the item's own description states it. */
const HOLD_SECONDS = 1;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);

/**
 * How often the facing is read while the key is down.
 *
 * Four ticks is a thirtieth of a second, which at `SHIP_TURN` (`300` degrees per
 * second) is ten degrees of turn — so the short-way-round step `heldTurn`
 * accumulates is the way the ship actually went, with eighteen times the stated
 * rate of headroom before it could be read backwards.
 */
const SAMPLE_TICKS = 4;

/**
 * The least turn that counts as having turned at all, in radians.
 *
 * A quarter of the `SHIP_TURN` (`300` degrees per second) `specs/ship.md` gives the
 * held second, so a build anywhere near the rate `flight/turn-rate-left` requires
 * clears it by a factor of four, and a facing nudged by rounding does not.
 */
const TURN_FLOOR = 0.25 * SHIP_TURN * HOLD_SECONDS;

/** Ticks with nothing held after the key comes up, long enough that a runaway shows. */
const COAST_TICKS = ticksFor(0.5);

/**
 * How far the facing may still drift after the key is released, in radians.
 *
 * `specs/ship.md` rotates only "while a turn key is held", so a released ship's
 * facing does not move at all and the whole of this allowance is the EDGE: the
 * release lands between ticks, and a build that reads its keyboard at the top of a
 * tick may carry one more tick of turn than one that reads it at the bottom. Two
 * ticks of the stated rate is five degrees. A build that went on turning covers a
 * hundred and fifty degrees across the coast, thirty times this.
 */
const STOPPED_TOL = 2 * SHIP_TURN * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the ship counter-clockwise while ArrowLeft is held, and stops on release", async () => {
  await startPlaying(h);

  const held = await heldTurn(h, KEY, HOLD_TICKS, SAMPLE_TICKS);
  await captureStill(h, "turn");
  await h.advance(COAST_TICKS);
  const coasted = (await h.snapshot()).ship.angle;

  // Counter-clockwise is the DECREASING direction (specs/overview.md), so the
  // accumulated turn is negative, and the floor is on its size.
  assertLessThan(
    held.turned,
    -TURN_FLOOR,
    "the counter-clockwise turn ArrowLeft held for a second (radians)",
  );
  assertLessThanOrEqual(
    angleBetween(held.angle, coasted),
    STOPPED_TOL,
    "the facing still drifting half a second after ArrowLeft came up (radians)",
  );
});
