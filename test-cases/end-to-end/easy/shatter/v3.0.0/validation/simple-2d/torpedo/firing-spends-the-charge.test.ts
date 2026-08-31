// torpedo/firing-spends-the-charge — a launch empties the charge.
//
// `specs/weapons.md`, "The charge": "Launching a torpedo spends the charge, taking
// it to `0`." `specs/instrumentation.md` makes both halves of that readable —
// `torpedoCharge` is the stored number and `torpedoReady` is true exactly when it
// is `1` — so a build that fires without paying, and one that pays but still
// reports itself ready, each fail here.
//
// WHAT THE TOLERANCE IS FOR, AND WHY IT IS NOT ROOM ON THE FIGURE. The reading is
// taken once the press has been delivered, which `Harness.tap` spends two ticks
// doing (the press tick and the release tick), and `specs/weapons.md` has the
// charge rise "linearly from `0` to `1` over `TORPEDO_RECHARGE` (`10` seconds)"
// from the moment it is spent. `specs/simulation.md` does not fix where in a tick
// the weapon input is read against where the refill runs, so a conformant build may
// have added as much as three ticks of the refill — `TICK_DT / TORPEDO_RECHARGE`
// each, some eight ten-thousandths apiece — by the time the roster is read. The
// bound below is exactly those three. A build that did not spend the charge reads
// `1`, four hundred times outside it.
//
// THE LAUNCH IS CONFIRMED BEFORE THE CHARGE IS READ. A press that launched nothing
// has not spent anything either, and "launching spends the charge" is vacuous
// against it; the roster is asserted first so such a build fails
// `the-torpedo-action-launches-one`, the item that decides the launch, rather than
// scoring this one for a charge it never had reason to spend.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { TICK_DT, TORPEDO_RECHARGE } from "../../src/constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  PRESS_TICKS,
  chargeOf,
  poseShip,
  pressTorpedo,
  readyOf,
  theTorpedo,
} from "./scene";

/**
 * How far above `0` the charge may read once the press has been delivered.
 *
 * Three ticks of the refill `specs/weapons.md` fixes — `TICK_DT /
 * TORPEDO_RECHARGE` each — which covers the two ticks a press costs plus a build
 * that runs its refill before it reads its weapon input. It is not slack on the
 * rule: a build that leaves the charge alone reads `1`.
 */
const SPENT_ALLOWANCE = ((PRESS_TICKS + 1) * TICK_DT) / TORPEDO_RECHARGE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes the charge to zero and reports the torpedo no longer ready", async () => {
  startPlaying(h);
  poseShip(h);

  const fired = await pressTorpedo(h);
  // The spent charge, the tick after the launch.
  captureStill(h, "spent");

  // Hard first: a press that launched nothing spent nothing either.
  theTorpedo(fired, "the launch whose charge is being read");

  assertLessThanOrEqual(
    chargeOf(fired, "the press a torpedo was launched on"),
    SPENT_ALLOWANCE,
    "the torpedo charge once a launch has been delivered (specs/weapons.md: " +
      "launching a torpedo spends the charge, taking it to 0), allowing the " +
      `${SPENT_ALLOWANCE.toExponential(2)} that ${PRESS_TICKS + 1} ticks of the ` +
      "ten-second refill are worth",
  );
  assertEqual(
    readyOf(fired, "the press a torpedo was launched on"),
    false,
    "torpedoReady once a launch has been delivered, which " +
      "specs/instrumentation.md makes true exactly when the charge is 1",
  );
});
