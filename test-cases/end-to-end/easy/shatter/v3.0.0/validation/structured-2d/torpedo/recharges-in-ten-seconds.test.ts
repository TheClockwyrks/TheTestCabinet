// torpedo/recharges-in-ten-seconds — a spent charge is full again ten seconds on.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The charge: "The charge then rises
// linearly from `0` to `1` over `TORPEDO_RECHARGE` (`10` seconds) of game time".
// This item decides the FIGURE — that the bar is full at ten seconds and not at
// three or at thirty. That the rise is LINEAR rather than eased or stepped is
// `torpedo/recharge-is-linear`'s point, and it reads the two intermediate values
// this one deliberately does not.
//
// THE CHARGE IS POSED EMPTY RATHER THAN SPENT BY A LAUNCH. `setTorpedoCharge(0)`
// reaches the scenario directly (`specs/instrumentation.md`: it "Sets the stored
// charge, a number from `0` to `1`"), and the rule the specification states is
// about a charge below `1` rather than about the launch that put it there. Firing
// to reach the same state would fold `torpedo/the-torpedo-action-launches-one` and
// `torpedo/firing-spends-the-charge` into this item's verdict, and would leave a
// torpedo in flight for the ten seconds this check runs for.
//
// BOTH ENDS OF "REACHES 1". The charge is read once, at exactly `TORPEDO_RECHARGE`
// of game time, and it must be neither short of the whole nor past it. A build
// that fills over twenty seconds reads `0.5`; one that fills over five reads the
// whole several seconds early but is caught by `recharge-is-linear`, not here;
// one that overfills reads above `1`, which `specs/weapons.md` bounds — the charge
// is "a number from `0` to `1`".
//
// NOTHING ELSE IS RUNNING. `startPlaying` leaves an empty field with both world
// gates shut and the ship's contact test off, so over the ten seconds this check
// advances nothing arrives, nothing is destroyed, and no respawn refills the
// charge behind the reading (`specs/weapons.md`: "A respawn refills the charge
// to `1`").

import { afterEach, beforeEach, it } from "vitest";
import { TORPEDO_RECHARGE } from "../../src/constants";
import { assertBetween, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { requireCharge, requireReady } from "./scenario";

/** The charge the refill starts from: empty, as a launch leaves it. */
const START_CHARGE = 0;

/**
 * How far from `1` the charge may read at `TORPEDO_RECHARGE`, as a fraction of
 * the bar.
 *
 * `0.03`, which is the 3 percent the review item states. The refill is a constant
 * rate over a fixed span, so the only latitude a conforming build has is where in
 * a tick it adds its increment and whether the tick that spent the charge also
 * refilled: `0.03` is thirty-six ticks of the refill, far more than either needs,
 * and it is a thirtieth of the way to any neighbouring figure a build might have
 * picked instead of ten seconds.
 */
const CHARGE_TOLERANCE = 0.03;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills the charge from 0 to 1 over TORPEDO_RECHARGE of game time", async () => {
  startPlaying(h);
  h.debug.setTorpedoCharge?.(START_CHARGE);

  assertEqual(
    requireCharge(h.snapshot(), "the charge the refill starts from"),
    START_CHARGE,
    "setTorpedoCharge(0) to leave the charge empty, so what the reading ten " +
      "seconds later shows is a whole refill (specs/instrumentation.md)",
  );

  await h.advance(ticksFor(TORPEDO_RECHARGE));
  const after = h.snapshot();
  // The charge back at full ten seconds on.
  captureStill(h, "recharged");

  const charge = requireCharge(after, "the charge at TORPEDO_RECHARGE");
  assertBetween(
    charge,
    1 - CHARGE_TOLERANCE,
    1,
    `torpedoCharge to have reached 1 at TORPEDO_RECHARGE (${TORPEDO_RECHARGE} ` +
      `s) of game time from empty, within ${CHARGE_TOLERANCE}, and to be no ` +
      "more than the 1 the charge is bounded by (specs/weapons.md); read " +
      `${charge.toFixed(4)}`,
  );

  assertEqual(
    requireReady(after, "the readiness at TORPEDO_RECHARGE"),
    true,
    "torpedoReady to read true once the charge is full again, which " +
      "specs/instrumentation.md makes true exactly when the charge is 1 " +
      `(specs/weapons.md); the charge read ${charge.toFixed(4)}`,
  );
});
