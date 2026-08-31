// Shatter — controls/rotate-a: `KeyA` turns the ship counter-clockwise.
//
// THE RULE. `specs/controls.md` puts `ArrowLeft` and `KeyA` on the same row of its
// key table, "Rotate counter-clockwise", so `KeyA` is the WASD half of the left
// turn rather than a second, lesser binding. `specs/ship.md` fixes the direction
// ("the left key turns counter-clockwise") and `specs/overview.md` the sign it reads
// as, quoting angles clockwise from the positive `x` axis on a field whose `y` runs
// downward, so a counter-clockwise turn DECREASES the facing.
//
// WHY IT IS A SEPARATE ITEM FROM `controls/rotate-left-arrow`. The two keys are one
// row of the table but two listeners in a build, and the commonest way to lose one
// is to wire the arrows and forget the letters. This item drives `KeyA` and nothing
// else, so a build with working arrows and dead letters loses exactly the four
// letter items rather than passing on the strength of its arrows — and the arrow
// item's own reading is untouched by whatever this one finds.
//
// THE KEY IS A REAL ONE. `hold` and `release` press through Chromium's own input
// pipeline, so what reaches the build is a browser-trusted DOM key event, delivered
// by its `code` — which is what makes `KeyA` the PHYSICAL key rather than the
// character a layout happens to put there, exactly as `specs/controls.md` states.
//
// WHAT THIS ITEM DOES NOT DECIDE. The rate, which is `flight/turn-rate-left`; and
// whether the turn stops on release, which the item's description leaves to
// `controls/rotate-left-arrow`, where `specs/controls.md`'s hold rule is graded.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan } from "../assert";
import { KEYS_LEFT, SHIP_TURN } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldTurn } from "./turn";

/** The key this item decides: the second of the two `specs/controls.md` binds left. */
const KEY = KEYS_LEFT[1];

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("turns the ship counter-clockwise while KeyA is held", async () => {
  await startPlaying(h);

  const held = await heldTurn(h, KEY, HOLD_TICKS, SAMPLE_TICKS);
  await captureStill(h, "turn");

  // Counter-clockwise is the DECREASING direction (specs/overview.md), so the
  // accumulated turn is negative, and the floor is on its size.
  assertLessThan(
    held.turned,
    -TURN_FLOOR,
    "the counter-clockwise turn KeyA held for a second (radians)",
  );
});
