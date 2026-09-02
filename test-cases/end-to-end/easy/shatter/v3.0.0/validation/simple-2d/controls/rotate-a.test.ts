// controls/rotate-a — `KeyA` turns the ship counter-clockwise.
//
// THE RULE. `specs/controls.md`'s binding table gives the `left` action two keys,
// `ArrowLeft` and `KeyA`, so `KeyA` is the WASD half of the left turn rather than a
// second, lesser binding; `left` means "Rotate counter-clockwise" while the game is
// being played. `specs/ship.md` fixes the direction ("the left key turns
// counter-clockwise") and `specs/overview.md` the sign it reads as, quoting angles
// clockwise from the positive `x` axis on a field whose `y` runs downward, so a
// counter-clockwise turn DECREASES the facing.
//
// WHY IT IS A SEPARATE ITEM FROM `controls/rotate-left-arrow`. The two keys are one
// row of the binding table, and under this engine one registration — but a build
// registers the action itself, and the commonest way to lose one is to hand the
// engine the arrows and forget the letters. This item drives `KeyA` and nothing
// else, so a build with working arrows and dead letters loses exactly the four
// letter items rather than passing on the strength of its arrows.
//
// THE KEY IS A REAL ONE. `hold` and `release` dispatch a `KeyboardEvent`-shaped
// event at the event target the engine listens on, which the engine's input
// contract states drives an action exactly as a player's key does — and it is
// delivered by its `code`, which is what makes `KeyA` the PHYSICAL key rather than
// the character a layout happens to put there, exactly as `specs/controls.md`
// states.
//
// THE KEY IS PINNED TO THE ITEM. `BINDINGS` is checked to bind `KeyA` to `left`
// rather than the second key of `left` being taken as whatever it happens to be, so
// a build that reordered the canonical bindings cannot be graded on `ArrowLeft`
// twice.
//
// WHAT THIS ITEM DOES NOT DECIDE. The rate, which is `flight/turn-rate-left`; and
// whether the turn stops on release, which the item's description leaves to
// `controls/rotate-left-arrow`, where `specs/controls.md`'s hold rule is graded.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, DEG, SHIP_TURN } from "../../src/constants";
import {
  assertContains,
  assertLessThan,
  assertLessThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldTurn } from "./drive";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "KeyA";
const ACTION = "left";

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
 * has the required size and sign for reasons that have nothing to do with KeyA.
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the ship counter-clockwise while KeyA is held", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `left` action to",
  );

  startPlaying(h);

  const lead = await heldTurn(h, undefined, LEAD_TICKS, SAMPLE_TICKS);
  const held = await heldTurn(h, KEY, HOLD_TICKS, SAMPLE_TICKS);
  captureStill(h, "turn");

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
    "the counter-clockwise turn KeyA held for a second (radians)",
  );
  assertLessThanOrEqual(
    held.mostClockwise,
    WRONG_WAY,
    `the largest clockwise turn any single sample of the ${KEY} hold ` +
      `made, in radians — a held turn is at a CONSTANT rate in one ` +
      `direction (specs/ship.md)`,
  );
});
