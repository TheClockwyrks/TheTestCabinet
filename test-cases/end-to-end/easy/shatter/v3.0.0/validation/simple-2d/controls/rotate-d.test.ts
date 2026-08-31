// controls/rotate-d — `KeyD` turns the ship clockwise.
//
// THE RULE. `specs/controls.md`'s binding table gives the `right` action two keys,
// `ArrowRight` and `KeyD`, so `KeyD` is the WASD half of the right turn rather than
// a second, lesser binding; `right` means "Rotate clockwise" while the game is
// being played. `specs/ship.md` fixes the direction ("the right key clockwise") and
// `specs/overview.md` the sign it reads as, quoting angles clockwise from the
// positive `x` axis on a field whose `y` runs downward, so a clockwise turn
// INCREASES the facing.
//
// WHY IT IS A SEPARATE ITEM FROM `controls/rotate-right-arrow`. The two keys are
// one row of the binding table, and under this engine one registration — but a
// build registers the action itself, and the commonest way to lose one is to hand
// the engine the arrows and forget the letters. This item drives `KeyD` and nothing
// else.
//
// THE KEY IS A REAL ONE. `hold` and `release` dispatch a `KeyboardEvent`-shaped
// event at the event target the engine listens on, which the engine's input
// contract states drives an action exactly as a player's key does — and it is
// delivered by its `code`, which is what makes `KeyD` the PHYSICAL key rather than
// the character a layout happens to put there, exactly as `specs/controls.md`
// states.
//
// THE KEY IS PINNED TO THE ITEM. `BINDINGS` is checked to bind `KeyD` to `right`
// rather than the second key of `right` being taken as whatever it happens to be,
// so a build that reordered the canonical bindings cannot be graded on `ArrowRight`
// twice.
//
// WHAT THIS ITEM DOES NOT DECIDE. The rate, which is `flight/turn-rate-right`; and
// whether the turn stops on release, which the item's description leaves to
// `controls/rotate-right-arrow`.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, SHIP_TURN } from "../../src/constants";
import { assertContains, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldTurn } from "./drive";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "KeyD";
const ACTION = "right";

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the ship clockwise while KeyD is held", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `right` action to",
  );

  startPlaying(h);

  const held = await heldTurn(h, KEY, HOLD_TICKS, SAMPLE_TICKS);
  captureStill(h, "turn");

  // Clockwise is the INCREASING direction (specs/overview.md).
  assertGreaterThan(
    held.turned,
    TURN_FLOOR,
    "the clockwise turn KeyD held for a second (radians)",
  );
});
