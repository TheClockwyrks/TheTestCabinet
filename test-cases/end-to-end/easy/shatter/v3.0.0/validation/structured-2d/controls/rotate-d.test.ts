// controls/rotate-d — `KeyD` turns the ship clockwise.
//
// `specs/controls.md`'s bindings table gives the `right` action TWO keys,
// `ArrowRight` and `KeyD`, and `specs/ship.md` says what `right` does: "the right
// key turns clockwise". A build that registered only the arrow has a game that
// plays, so this point is capped lower than its arrow twin — but it is a separate
// point, because the second key is a separate deliverable and a build that shipped
// one and not the other should lose exactly one of them.
//
// THE KEY IS DRIVEN, NOT THE ACTION. This is the whole reason the item exists.
// `harness.ts`'s `tapAction`, `holdAction` and `holdActionFor` drive an action's
// FIRST bound key — `ArrowRight` for `right` — so a check written through them
// would grade the two keys as one and pass a build with no `KeyD` binding at all.
// The literal `KeyboardEvent.code` goes down instead, at the event target the
// engine's input system listens on, so the action is raised by the binding the
// case declares rather than by anything this check reaches into.
//
// THE DIRECTION IS THE REQUIREMENT, NOT THE RATE. `flight/turn-rate-right` decides
// that a held `right` turns `SHIP_TURN` (`300` degrees) in a second; asserting a
// rate here as well would cost one build two items for one fault. What this
// asserts is a SIGN: the accumulated turn is clockwise, and no single tick of the
// hold went the other way.
//
// CLOCKWISE IS A POSITIVE TURN. `specs/overview.md` fixes the field's y axis
// running down and angles measured clockwise from `+x`, so a clockwise swing
// raises the facing. The turn is accumulated tick by tick rather than read off two
// angles, because an angle says where the ship points and never which way it swung
// to get there — `keys.ts`.
//
// WHAT THIS DOES NOT DECIDE. The turn rate (`flight/turn-rate-right`), that the
// turn stops on release (`controls/rotate-right-arrow`, whose item states that
// clause), and the arrow binding itself.

import { afterEach, beforeEach, it } from "vitest";
import { DEG } from "../../src/constants";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { turnAcross } from "./keys";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "KeyD";

/** The quiet stretch driven before the key goes down, in ticks. */
const LEAD_TICKS = ticksFor(0.25);

/** The hold, in ticks: one second, as its arrow twin holds for. */
const HOLD_TICKS = ticksFor(1);

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
 * The largest COUNTER-CLOCKWISE turn a single tick of the hold may show, in
 * radians.
 *
 * Zero, to the width of the floating-point noise the wrapped-difference
 * arithmetic in `keys.ts` carries: `specs/ship.md` fixes the held turn as
 * CONSTANT and clockwise, so no tick of it goes the other way.
 */
const WRONG_WAY = -1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("turns the ship clockwise while KeyD is held", async () => {
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
  assertGreaterThan(
    held.total,
    0,
    `radians the facing turned over ${String(HOLD_TICKS)} ticks with ${KEY} ` +
      "held, signed clockwise-positive: KeyD drives the same right action " +
      "ArrowRight does (specs/controls.md) and the right key turns CLOCKWISE " +
      "(specs/ship.md), which raises a facing measured clockwise from +x " +
      "(specs/overview.md)",
  );
  assertGreaterThan(
    held.mostCounterClockwise,
    WRONG_WAY,
    `the largest counter-clockwise turn any single tick of the ${KEY} hold ` +
      "made, in radians, signed clockwise-positive — a held turn is at a " +
      "CONSTANT rate in one direction (specs/ship.md)",
  );
});
