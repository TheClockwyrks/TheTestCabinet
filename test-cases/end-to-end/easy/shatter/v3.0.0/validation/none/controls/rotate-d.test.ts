// Shatter — controls/rotate-d: `KeyD` turns the ship clockwise.
//
// THE RULE. `specs/controls.md` puts `ArrowRight` and `KeyD` on the same row of its
// key table, "Rotate clockwise", so `KeyD` is the WASD half of the right turn rather
// than a second, lesser binding. `specs/ship.md` fixes the direction ("the right key
// clockwise") and `specs/overview.md` the sign it reads as, quoting angles clockwise
// from the positive `x` axis on a field whose `y` runs downward, so a clockwise turn
// INCREASES the facing.
//
// WHY IT IS A SEPARATE ITEM FROM `controls/rotate-right-arrow`. The two keys are one
// row of the table but two listeners in a build, and the commonest way to lose one
// is to wire the arrows and forget the letters. This item drives `KeyD` and nothing
// else.
//
// THE KEY IS A REAL ONE. `hold` and `release` press through Chromium's own input
// pipeline, so what reaches the build is a browser-trusted DOM key event, delivered
// by its `code` — which is what makes `KeyD` the PHYSICAL key rather than the
// character a layout happens to put there, exactly as `specs/controls.md` states.
//
// WHAT THIS ITEM DOES NOT DECIDE. The rate, which is `flight/turn-rate-right`; and
// whether the turn stops on release, which the item's description leaves to
// `controls/rotate-right-arrow`.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { DEG, KEYS_RIGHT, SHIP_TURN } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldTurn } from "./turn";

/** The key this item decides: the second of the two `specs/controls.md` binds right. */
const KEY = KEYS_RIGHT[1];

/** The second the key is held for, the same span the arrow item uses. */
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
 * has the required size and sign for reasons that have nothing to do with KeyD.
 */
const STOPPED_TURN = 1 * DEG;

/**
 * The furthest a single sample step of the hold may go the WRONG way, in radians.
 *
 * Zero, to the width of the floating-point noise the wrapped-difference
 * arithmetic in `turn.ts` carries. `specs/ship.md` fixes the held turn as CONSTANT and
 * in one direction, so no step of it reverses; a total of the right sign alone
 * would be reached by a build that swung the ship one way and part of the way
 * back.
 */
const WRONG_WAY = -1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the ship clockwise while KeyD is held", async () => {
  await startPlaying(h);

  const lead = await heldTurn(h, undefined, LEAD_TICKS, SAMPLE_TICKS);
  const held = await heldTurn(h, KEY, HOLD_TICKS, SAMPLE_TICKS);
  await captureStill(h, "turn");

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
    "the clockwise turn KeyD held for a second (radians)",
  );
  assertGreaterThan(
    held.mostCounterClockwise,
    WRONG_WAY,
    `the largest counter-clockwise turn any single sample of the ${KEY} ` +
      `hold made, in radians, signed clockwise-positive — a held turn is at ` +
      `a CONSTANT rate in one direction (specs/ship.md)`,
  );
});
