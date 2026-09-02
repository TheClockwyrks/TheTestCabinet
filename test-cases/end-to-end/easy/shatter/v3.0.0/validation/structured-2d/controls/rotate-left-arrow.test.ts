// controls/rotate-left-arrow — `ArrowLeft` turns the ship counter-clockwise.
//
// `specs/controls.md` binds `ArrowLeft` to the `left` action, and `specs/ship.md`
// says what `left` does: "While a turn key is held the facing rotates at a
// constant `SHIP_TURN` ... the left key turns counter-clockwise". The same file
// makes the reading a HOLD — `specs/controls.md`: "the ship turns and accelerates
// for as long as the key is down and stops the moment it is released" — so this
// point is decided over THREE stretches: the ship at rest with nothing down, the
// key held for the second the item names, and the ship at rest again after it
// comes up.
//
// THE KEY IS DRIVEN, NOT THE ACTION. `specs/instrumentation.md` carries no
// operation that turns, and no operation that raises an action either: the
// keyboard belongs to the engine beneath the game, and this point is about one
// BINDING, so the literal `KeyboardEvent.code` the specification's table names is
// what goes down. `harness.ts`'s `tapAction` and friends drive an action's FIRST
// bound key, which would grade `ArrowLeft` and `KeyA` as one thing; the whole
// point of this item and of `controls/rotate-a` is that they are two.
//
// THE DIRECTION IS THE REQUIREMENT; THE RATE IS NOT, BUT A FLOOR IS.
// `flight/turn-rate-left` decides that a held `left` turns `SHIP_TURN`
// (`300` degrees) in a second, within three percent, and asserting THAT here as
// well would cost one build two items for one fault. So what this asserts about
// the size of the turn is a floor a QUARTER of it: a build anywhere near the
// stated rate clears `TURN_FLOOR` by a factor of four, and one whose rate is
// wrong still fails there rather than here.
//
// WHY A FLOOR AND NOT A BARE SIGN. A sign alone — a turn merely greater than
// zero — is met by a build with no such binding at all: the facing need only end
// a hair off where it started, and the very rounding drift this check ALLOWS
// across the quiet lead (`STOPPED_TURN`, a whole degree) is more than enough to
// carry it. The floor is what makes the reading mean "ArrowLeft turned the ship"
// rather than "the facing moved". The SIGN remains the point: the accumulated
// turn is counter-clockwise, and no single tick of the hold went the other way.
//
// COUNTER-CLOCKWISE IS A NEGATIVE TURN. `specs/overview.md` fixes the field's
// y axis running down and angles measured clockwise from `+x`, so a clockwise
// swing raises the facing and a counter-clockwise one lowers it. The turn is
// accumulated tick by tick rather than read off two angles, because an angle says
// where the ship points and never which way it swung to get there — `keys.ts`.
//
// WHAT THIS DOES NOT DECIDE. The turn rate (`flight/turn-rate-left`), that
// rotating leaves the velocity alone (`flight/rotation-keeps-velocity`), and the
// clockwise binding, which is `controls/rotate-right-arrow`'s.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SHIP_TURN, TICK_HZ } from "../../src/constants";
import { assertLessThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { turnAcross } from "./keys";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "ArrowLeft";

/** The quiet stretch driven before the key goes down, in ticks. */
const LEAD_TICKS = ticksFor(0.25);

/** The hold, in ticks: the one second the item names. */
const HOLD_SECONDS = 1;
const HOLD_TICKS = ticksFor(HOLD_SECONDS);
/**
 * The least turn that counts as having turned at all, in radians.
 *
 * A QUARTER of the turn the held second is worth at the `SHIP_TURN` (`300`
 * degrees per second) `specs/ship.md` fixes, so a build anywhere near the rate
 * `flight/turn-rate-left` requires clears it by a factor of four, and a build whose
 * facing merely creeps — by a rounding, a renormalization, or a turn at a token
 * fraction of the stated rate — does not. Reading the DIRECTION alone would pass
 * every one of those.
 */
const TURN_FLOOR = 0.25 * SHIP_TURN * HOLD_SECONDS;

/** The quiet stretch driven after the key comes up, in ticks. */
const COAST_TICKS = ticksFor(0.25);

/**
 * The turn a stretch with nothing held may accumulate, in radians.
 *
 * One degree, which is less than HALF of the `2.5` degrees one tick of the rate
 * `specs/ship.md` fixes (`SHIP_TURN`, `300` degrees per second, at `TICK_HZ`
 * `120`) would turn — so a build that kept turning for even one tick after the
 * release exceeds it. Rotation is the only thing that changes the facing
 * (`specs/ship.md`: "Rotation changes the facing alone"; the star never pulls the
 * ship), so a ship with no turn key down should not move its facing at all, and
 * this is the allowance for a build that rounds or renormalizes its angle.
 */
const STOPPED_TURN = 1 * DEG;

/**
 * The largest CLOCKWISE turn a single tick of the hold may show, in radians.
 *
 * Zero, to the width of the floating-point noise the wrapped-difference
 * arithmetic in `keys.ts` carries: `specs/ship.md` fixes the held turn as
 * CONSTANT and counter-clockwise, so no tick of it goes the other way.
 */
const WRONG_WAY = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the ship counter-clockwise while ArrowLeft is held, and stops on release", async () => {
  // Live play on the empty, quiet field, with the ship at the safe point at rest.
  // Nothing else on the field can reach the ship, and nothing but a turn key can
  // reach its facing.
  startPlaying(h);

  const lead = await turnAcross(h, LEAD_TICKS);
  const held = await turnAcross(h, HOLD_TICKS, KEY);
  captureStill(h, "turn");
  const coast = await turnAcross(h, COAST_TICKS);

  assertLessThanOrEqual(
    Math.abs(lead.total),
    STOPPED_TURN,
    `radians the facing moved over ${String(LEAD_TICKS)} ticks with no key ` +
      "down, before the hold — the ship turns only while a turn key is held " +
      "(specs/controls.md)",
  );
  assertLessThan(
    held.total,
    -TURN_FLOOR,
    `radians the facing turned over ${String(HOLD_TICKS)} ticks with ${KEY} ` +
      "held, signed clockwise-positive: the left key turns COUNTER-clockwise " +
      "(specs/ship.md), which lowers a facing measured clockwise from +x " +
      "(specs/overview.md)",
  );
  assertLessThanOrEqual(
    held.mostClockwise,
    WRONG_WAY,
    `the largest clockwise turn any single tick of the ${KEY} hold made, in ` +
      "radians — a held turn is at a CONSTANT rate in one direction " +
      "(specs/ship.md)",
  );
  assertLessThanOrEqual(
    Math.abs(coast.total),
    STOPPED_TURN,
    `radians the facing moved over the ${String(COAST_TICKS)} ticks after ` +
      `${KEY} came up — the turn stops the moment the key is released ` +
      `(specs/controls.md), and one tick of ${String(SHIP_TURN / DEG)} degrees ` +
      `per second at ${String(TICK_HZ)} Hz would be more than this`,
  );
});
