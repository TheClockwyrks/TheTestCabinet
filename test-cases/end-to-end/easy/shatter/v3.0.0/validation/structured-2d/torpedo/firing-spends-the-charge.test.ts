// torpedo/firing-spends-the-charge — a launch takes the charge to 0.
//
// THE RULE. `specs/weapons.md`, "The torpedo", The charge: "Launching a torpedo
// spends the charge, taking it to `0`." `specs/instrumentation.md` makes
// `torpedoReady` "true exactly when the charge is `1`", so a spent charge reports
// `false` as well.
//
// WHY THE READING IS TAKEN THE TICK AFTER THE LAUNCH. The charge is spent by the
// launch itself, so the earliest honest reading is the first snapshot in which
// the torpedo exists — and that is the tick the press ran on. Waiting longer
// would read the refill this item is not about: `specs/weapons.md` starts the
// charge rising the moment it is below `1`, and `torpedo/recharges-in-ten-seconds`
// and `torpedo/recharge-is-linear` are the items that grade it.
//
// EVERY WRONG MODEL READS AS A DIFFERENT NUMBER. A build that launches without
// spending reads `1`; one that takes a fixed fraction off reads that fraction
// short of `1`; one that spends the charge but reports readiness off a separate
// flag reads `0` and `true`, which the second assertion catches. The launch
// itself is hard-asserted first, so a build that launched nothing fails
// `torpedo/the-torpedo-action-launches-one` and is named here rather than passing
// on a charge it never spent.

import { afterEach, beforeEach, it } from "vitest";
import { TICK_DT, TORPEDO_RECHARGE } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  requireOnlyTorpedo,
  startPlaying,
  tapAction,
  type Harness,
} from "../harness";
import {
  POSED_CHARGE_SLACK,
  TORPEDO_ACTION,
  requireCharge,
  requireReady,
} from "./scenario";

/**
 * How far above `0` the charge may read on the tick of the launch, as a fraction
 * of the bar.
 *
 * Four ticks of the refill. `specs/weapons.md` has the charge rise from `0` to
 * `1` over `TORPEDO_RECHARGE`, which is `1 / 1200` of the bar a tick, and
 * `specs/simulation.md` does not fix where in a tick the launch sits against the
 * refill — so a conforming build may have added a tick or two of charge on the
 * tick it spent it. Four ticks is `0.0033`, which is generous room for that and
 * a hundred and fifty times short of the `0.5` the nearest wrong model (a launch
 * that costs half the bar) would read.
 */
const SPENT_TOLERANCE = (4 * TICK_DT) / TORPEDO_RECHARGE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads torpedoCharge 0 and torpedoReady false the tick a torpedo launches", async () => {
  startPlaying(h);

  assertLessThanOrEqual(
    Math.abs(
      requireCharge(h.snapshot(), "the charge the launch is made on") - 1,
    ),
    POSED_CHARGE_SLACK,
    "the charge full before the press, so what the reading after it shows is " +
      "what the launch spent (specs/weapons.md)",
  );

  await tapAction(h, TORPEDO_ACTION);
  const after = h.snapshot();
  // The spent charge the tick after a launch.
  captureStill(h, "spent");

  requireOnlyTorpedo(
    after,
    "one press of the torpedo key on a charged ship launches one " +
      "(torpedo/the-torpedo-action-launches-one), and only a launch spends " +
      "the charge",
  );

  const charge = requireCharge(after, "the charge the tick after a launch");
  assertLessThanOrEqual(
    charge,
    SPENT_TOLERANCE,
    "torpedoCharge to read 0 the tick a torpedo launched — launching spends " +
      `the charge, taking it to 0 (specs/weapons.md); read ${String(charge)}, ` +
      `against an allowance of ${SPENT_TOLERANCE.toFixed(4)} for the refill ` +
      "that may already have begun",
  );

  assertEqual(
    requireReady(after, "the readiness the tick after a launch"),
    false,
    "torpedoReady to read false the tick a torpedo launched, which " +
      "specs/instrumentation.md makes true exactly when the charge is 1 — and " +
      `the charge read ${String(charge)} (specs/weapons.md)`,
  );
});
