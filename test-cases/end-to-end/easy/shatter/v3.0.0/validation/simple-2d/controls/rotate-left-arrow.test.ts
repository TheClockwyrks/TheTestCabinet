// controls/rotate-left-arrow — `ArrowLeft` turns the ship counter-clockwise, and
// releasing it stops the turn.
//
// THE RULE. `specs/controls.md` binds `ArrowLeft` to the `left` action and gives
// `left` the meaning "Rotate counter-clockwise" while the game is being played, and
// reads rotation as a HOLD: "the ship turns and accelerates for as long as the key
// is down and stops the moment it is released". `specs/ship.md` fixes which way
// that is — "the left key turns counter-clockwise" — and `specs/overview.md` fixes
// the sign it reads as, quoting angles clockwise from the positive `x` axis on a
// field whose `y` runs downward, so a counter-clockwise turn DECREASES the facing.
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
// operation at all, so there is no shorter route: a facing posed with
// `setShipAngle` would grade the pose rather than the key.
//
// THE KEY IS PINNED TO THE ITEM. `BINDINGS` is checked to bind `ArrowLeft` to
// `left` rather than the first key of `left` being taken as whatever it happens to
// be. A build that reordered or rewrote the canonical bindings would otherwise be
// graded on `KeyA` here and on `ArrowLeft` at `controls/rotate-a`, and both items
// would pass while the key each names does nothing.
//
// WHAT THIS ITEM DOES NOT DECIDE. The RATE. How fast a held key turns the ship is
// `flight/turn-rate-left`, which holds it to `SHIP_TURN` within three percent;
// asserting it here as well would cost one build two points for one fault. The
// floor below is therefore a quarter of the stated turn, which rules out a facing
// that moved by rounding noise and nothing else. Nor does it decide that rotation
// leaves the VELOCITY alone — that is `flight/rotation-keeps-velocity` — so the
// ship is posed at rest and no other faculty is touched.
//
// THE WORLD IS EMPTY. `startPlaying` clears every roster, shuts both world gates
// and the ship's contact gate, and puts the ship at the safe point at rest facing
// `FACE_UP`. Nothing else is on the field to turn, hit or spawn, so the only thing
// that can move the facing across the drive is the key this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, DEG, SHIP_TURN, TICK_DT } from "../../src/constants";
import {
  assertContains,
  assertLessThan,
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
const KEY = "ArrowLeft";
const ACTION = "left";

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
 * has the required size and sign for reasons that have nothing to do with ArrowLeft.
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
const WRONG_WAY = 1e-9;

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

it("turns the ship counter-clockwise while ArrowLeft is held, and stops on release", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `left` action to",
  );

  startPlaying(h);

  const lead = await heldTurn(h, undefined, LEAD_TICKS, SAMPLE_TICKS);
  const held = await heldTurn(h, KEY, HOLD_TICKS, SAMPLE_TICKS);
  captureStill(h, "turn");
  await h.advance(COAST_TICKS);
  const coasted = h.snapshot().ship.angle;

  // Counter-clockwise is the DECREASING direction (specs/overview.md), so the
  // accumulated turn is negative, and the floor is on its size.
  assertLessThanOrEqual(
    Math.abs(lead.turned),
    STOPPED_TURN,
    `radians the facing moved over ${String(LEAD_TICKS)} ticks with no key ` +
      `down, before the hold — the ship turns only while a turn key is held ` +
      `(specs/controls.md)`,
  );
  assertLessThan(
    held.turned,
    -TURN_FLOOR,
    "the counter-clockwise turn ArrowLeft held for a second (radians)",
  );
  assertLessThanOrEqual(
    angleGap(held.angle, coasted),
    STOPPED_TOL,
    "the facing still drifting half a second after ArrowLeft came up (radians)",
  );
  assertLessThanOrEqual(
    held.mostClockwise,
    WRONG_WAY,
    `the largest clockwise turn any single sample of the ${KEY} hold ` +
      `made, in radians — a held turn is at a CONSTANT rate in one ` +
      `direction (specs/ship.md)`,
  );
});
