// controls/rotate-a — `KeyA` turns the ship counter-clockwise.
//
// `specs/controls.md`'s bindings table gives the `left` action TWO keys,
// `ArrowLeft` and `KeyA`, and `specs/ship.md` says what `left` does: "the left key
// turns counter-clockwise". A build that registered only the arrow has a game that
// plays, so this point is capped lower than its arrow twin — but it is a separate
// point, because the second key is a separate deliverable and a build that shipped
// one and not the other should lose exactly one of them.
//
// THE KEY IS DRIVEN, NOT THE ACTION. This is the whole reason the item exists.
// `harness.ts`'s `tapAction`, `holdAction` and `holdActionFor` drive an action's
// FIRST bound key — `ArrowLeft` for `left` — so a check written through them would
// grade the two keys as one and pass a build with no `KeyA` binding at all. The
// literal `KeyboardEvent.code` goes down instead, at the event target the engine's
// input system listens on, so the action is raised by the binding the case
// declares rather than by anything this check reaches into.
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
// carry it. The floor is what makes the reading mean "KeyA turned the ship"
// rather than "the facing moved". The SIGN remains the point: the accumulated
// turn is counter-clockwise, and no single tick of the hold went the other way.
//
// COUNTER-CLOCKWISE IS A NEGATIVE TURN. `specs/overview.md` fixes the field's
// y axis running down and angles measured clockwise from `+x`, so a
// counter-clockwise swing lowers the facing. The turn is accumulated tick by tick
// rather than read off two angles, because an angle says where the ship points and
// never which way it swung to get there — `keys.ts`.
//
// WHAT THIS DOES NOT DECIDE. The turn rate (`flight/turn-rate-left`), that the
// turn stops on release (`controls/rotate-left-arrow`, whose item states that
// clause), and the arrow binding itself.

import { afterEach, beforeEach, it } from "vitest";
import { DEG, SHIP_TURN } from "../constants";
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
const KEY = "KeyA";

/** The quiet stretch driven before the key goes down, in ticks. */
const LEAD_TICKS = ticksFor(0.25);

/** The hold, in ticks: one second, as its arrow twin holds for. */
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

/**
 * The turn the quiet stretch before the hold may accumulate, in radians.
 *
 * One degree, which is less than HALF of the `2.5` degrees one tick of the rate
 * `specs/ship.md` fixes (`SHIP_TURN`, `300` degrees per second, at `TICK_HZ`
 * `120`) would turn. Rotation is the only thing that changes the facing
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

it("turns the ship counter-clockwise while KeyA is held", async () => {
  // Live play on the empty, quiet field, with the ship at the safe point at rest.
  // Nothing else on the field can reach the ship, and nothing but a turn key can
  // reach its facing.
  startPlaying(h);

  const lead = await turnAcross(h, LEAD_TICKS);
  const held = await turnAcross(h, HOLD_TICKS, KEY);
  captureStill(h, "turn");

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
      "held, signed clockwise-positive: KeyA drives the same left action " +
      "ArrowLeft does (specs/controls.md) and the left key turns " +
      "COUNTER-clockwise (specs/ship.md), which lowers a facing measured " +
      "clockwise from +x (specs/overview.md)",
  );
  assertLessThanOrEqual(
    held.mostClockwise,
    WRONG_WAY,
    `the largest clockwise turn any single tick of the ${KEY} hold made, in ` +
      "radians — a held turn is at a CONSTANT rate in one direction " +
      "(specs/ship.md)",
  );
});
