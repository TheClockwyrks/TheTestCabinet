// controls/rotate-right-arrow — `ArrowRight` turns the ship clockwise, and
// releasing it stops the turn.
//
// THE RULE. `specs/controls.md` binds `ArrowRight` to the `right` action and gives
// `right` the meaning "Rotate clockwise" while the game is being played, and reads
// rotation as a HOLD: "the ship turns and accelerates for as long as the key is
// down and stops the moment it is released". `specs/ship.md` fixes which way that
// is — "the right key clockwise" — and `specs/overview.md` fixes the sign it reads
// as, quoting angles clockwise from the positive `x` axis on a field whose `y` runs
// downward, so a clockwise turn INCREASES the facing.
//
// THIS IS THE OTHER DIRECTION, GRADED ON ITS OWN. A build that turns
// counter-clockwise whichever key is held fails this item and passes
// `controls/rotate-left-arrow`, which is the point of splitting them — and under
// this engine that is a live fault, since `left` and `right` are two registrations
// that a build may have crossed.
//
// THE KEY IS A REAL ONE. `hold` and `release` dispatch a `KeyboardEvent`-shaped
// event at the very event target the engine attached its own `keydown` and `keyup`
// listeners to, which the engine's input contract states drives an action exactly
// as a player's key does. Under this engine `specs/controls.md` puts the keyboard
// on the engine's side of the line — input reaches the game as named actions — so
// what a key press grades is the build's two halves of that path: that it
// REGISTERED the action against the keys `BINDINGS` gives it ("the whole of
// `ACTIONS` is registered"), and that it READS that action on this screen and turns
// the ship by it. `specs/instrumentation.md` gives the debug surface no keyboard
// operation at all, so there is no shorter route.
//
// THE KEY IS PINNED TO THE ITEM. `BINDINGS` is checked to bind `ArrowRight` to
// `right` rather than the first key of `right` being taken as whatever it happens
// to be, so a build that reordered the canonical bindings cannot be graded on
// `KeyD` here and pass while `ArrowRight` does nothing.
//
// WHAT THIS ITEM DOES NOT DECIDE. The RATE, which is `flight/turn-rate-right`; the
// floor below is a quarter of the stated turn and rules out a facing that moved by
// rounding noise alone. Nor that rotation leaves the VELOCITY alone, which is
// `flight/rotation-keeps-velocity`.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, DEG, SHIP_TURN, TICK_DT } from "../constants";
import {
  assertContains,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { angleGap } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldTurn } from "./drive";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "ArrowRight";
const ACTION = "right";

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

/** The quiet stretch driven before the key goes down, in ticks. */
const LEAD_TICKS = ticksFor(0.25);

/**
 * How far the facing may move across that quiet stretch, in radians.
 *
 * One degree, which is less than half of the `2.5` degrees a single tick of
 * `SHIP_TURN` (`300` degrees per second, at `TICK_HZ`) would turn.
 * `specs/ship.md` moves the facing by rotation alone — the star never pulls the
 * ship — so a ship with no turn key down does not turn at all, and this is the
 * allowance for a build that rounds or renormalizes its angle.
 *
 * WHY THE LEAD IS READ AT ALL. Without it, a build that spins the ship on its own
 * and never binds this key at all satisfies the turn below: the accumulated turn
 * has the required size and sign for reasons that have nothing to do with ArrowRight.
 */
const STOPPED_TURN = 1 * DEG;

/**
 * The furthest a single sample step of the hold may go the WRONG way, in radians.
 *
 * Zero, to the width of the floating-point noise the wrapped-difference
 * arithmetic in `drive.ts` carries. `specs/ship.md` fixes the held turn as CONSTANT and
 * in one direction, so no step of it reverses; a total of the right sign alone
 * would be reached by a build that swung the ship one way and part of the way
 * back.
 */
const WRONG_WAY = -1e-9;

/** Ticks with nothing held after the key comes up, long enough that a runaway shows. */
const COAST_TICKS = ticksFor(0.5);

/**
 * How far the facing may still drift after the key is released, in radians.
 *
 * `specs/ship.md` rotates only "while a turn key is held", so a released ship's
 * facing does not move at all and the whole of this allowance is the EDGE: the
 * release lands between ticks, and a build that reads the action at the top of a
 * tick may carry one more tick of turn than one that reads it at the bottom. Two
 * ticks of the stated rate is five degrees. A build that went on turning covers a
 * hundred and fifty degrees across the coast, thirty times this.
 */
const STOPPED_TOL = 2 * SHIP_TURN * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the ship clockwise while ArrowRight is held, and stops on release", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `right` action to",
  );

  startPlaying(h);

  const lead = await heldTurn(h, undefined, LEAD_TICKS, SAMPLE_TICKS);
  const held = await heldTurn(h, KEY, HOLD_TICKS, SAMPLE_TICKS);
  captureStill(h, "turn");
  await h.advance(COAST_TICKS);
  const coasted = h.snapshot().ship.angle;

  // Clockwise is the INCREASING direction (specs/overview.md).
  assertLessThanOrEqual(
    Math.abs(lead.turned),
    STOPPED_TURN,
    `radians the facing moved over ${String(LEAD_TICKS)} ticks with no key ` +
      `down, before the hold — the ship turns only while a turn key is held ` +
      `(specs/controls.md)`,
  );
  assertGreaterThan(
    held.turned,
    TURN_FLOOR,
    "the clockwise turn ArrowRight held for a second (radians)",
  );
  assertLessThanOrEqual(
    angleGap(held.angle, coasted),
    STOPPED_TOL,
    "the facing still drifting half a second after ArrowRight came up (radians)",
  );
  assertGreaterThan(
    held.mostCounterClockwise,
    WRONG_WAY,
    `the largest counter-clockwise turn any single sample of the ${KEY} ` +
      `hold made, in radians, signed clockwise-positive — a held turn is at ` +
      `a CONSTANT rate in one direction (specs/ship.md)`,
  );
});
