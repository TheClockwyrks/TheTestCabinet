// Shatter — controls/rotate-right-arrow: `ArrowRight` turns the ship clockwise, and
// releasing it stops the turn.
//
// THE RULE. `specs/controls.md` binds `ArrowRight` to "Rotate clockwise" while the
// game is being played, and reads rotation as a HOLD: "the ship turns and
// accelerates for as long as the key is down and stops the moment it is released".
// `specs/ship.md` fixes which way that is — "the right key clockwise" — and
// `specs/overview.md` fixes the sign it reads as, quoting angles clockwise from the
// positive `x` axis on a field whose `y` runs downward, so a clockwise turn
// INCREASES the facing.
//
// THE KEY IS A REAL ONE. `hold` and `release` press through Chromium's own input
// pipeline, so what reaches the build is a browser-trusted DOM key event on the real
// page rather than a synthetic one posed at whichever target a runtime happens to
// listen on. `specs/instrumentation.md` puts the keyboard in the runtime layer an
// engineless build supplies and gives the debug surface no keyboard operation at
// all, so the whole path — physical key, the build's own listener, the ship's
// rotation step — is the build's, and every step of it is exercised here.
//
// THIS IS THE OTHER DIRECTION, GRADED ON ITS OWN. A build that turns
// counter-clockwise whichever key is held fails this item and passes
// `controls/rotate-left-arrow`, which is the point of splitting them.
//
// WHAT THIS ITEM DOES NOT DECIDE. The RATE, which is `flight/turn-rate-right`; the
// floor below is a quarter of the stated turn and rules out a facing that moved by
// rounding noise alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { KEYS_RIGHT, SHIP_TURN, TICK_DT } from "../constants";
import { angleBetween } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldTurn } from "./turn";

/** The key this item decides: the first of the two `specs/controls.md` binds right. */
const KEY = KEYS_RIGHT[0];

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
 * held second, so a build anywhere near the rate `flight/turn-rate-right` requires
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

it("turns the ship clockwise while ArrowRight is held, and stops on release", async () => {
  await startPlaying(h);

  const held = await heldTurn(h, KEY, HOLD_TICKS, SAMPLE_TICKS);
  await captureStill(h, "turn");
  await h.advance(COAST_TICKS);
  const coasted = (await h.snapshot()).ship.angle;

  // Clockwise is the INCREASING direction (specs/overview.md).
  assertGreaterThan(
    held.turned,
    TURN_FLOOR,
    "the clockwise turn ArrowRight held for a second (radians)",
  );
  assertLessThanOrEqual(
    angleBetween(held.angle, coasted),
    STOPPED_TOL,
    "the facing still drifting half a second after ArrowRight came up (radians)",
  );
});
