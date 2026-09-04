// torpedo/firing-spends-the-charge — a launch empties the charge.
//
// specs/weapons.md, "The charge": "Launching a torpedo spends the charge, taking
// it to `0`." specs/instrumentation.md makes both halves of that readable —
// `torpedoCharge` is the stored number and `torpedoReady` is true exactly when it
// is `1` — so a build that fires without paying, and one that pays but still
// reports itself ready, each fail here.
//
// WHAT THE TOLERANCE IS FOR, AND WHY IT IS NOT ROOM ON THE FIGURE. The reading is
// taken on the tick the press was delivered on, and specs/weapons.md has the
// charge rise "linearly from `0` to `1` over `TORPEDO_RECHARGE` (`10` seconds)"
// from the moment it is spent. specs/simulation.md does not fix where in a tick
// the gun is read, so a build that runs its refill after its weapon input reads
// `0` and one that runs it before reads one tick of the refill — `TICK_DT /
// TORPEDO_RECHARGE`, some eight ten-thousandths. The bound below is two of those.
// A build that did not spend the charge reads `1`, a thousand times outside it.
//
// THE LAUNCH IS CONFIRMED BEFORE THE CHARGE IS READ. A press that launched nothing
// has not spent anything either, and "launching spends the charge" is vacuous
// against it; the roster is asserted first so such a build fails
// `the-torpedo-action-launches-one`, the item that decides the launch, rather than
// scoring this one for a charge it never had reason to spend.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { TICK_DT, TORPEDO_RECHARGE } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { chargeOf, poseShip, pressTorpedo, readyOf, theTorpedo } from "./scene";

/**
 * How far above `0` the charge may read on the tick of the launch.
 *
 * Two ticks of the refill specs/weapons.md fixes — `TICK_DT /
 * TORPEDO_RECHARGE` each — which covers a build that refills before it reads its
 * weapon input as well as one that refills after. It is not slack on the rule: a
 * build that leaves the charge alone reads `1`.
 */
const SPENT_ALLOWANCE = (2 * TICK_DT) / TORPEDO_RECHARGE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the charge to zero and reports the torpedo no longer ready", async () => {
  await startPlaying(h);
  await poseShip(h);

  const fired = await pressTorpedo(h);
  // The spent charge, the tick after the launch.
  await captureStill(h, "spent");

  // Hard first: a press that launched nothing spent nothing either.
  theTorpedo(fired, "the launch whose charge is being read");

  assertLessThanOrEqual(
    chargeOf(fired, "the tick a torpedo was launched on"),
    SPENT_ALLOWANCE,
    "the torpedo charge the tick after a launch (specs/weapons.md: launching " +
      `a torpedo spends the charge, taking it to 0), allowing the ${SPENT_ALLOWANCE.toExponential(2)} ` +
      "one tick of the ten-second refill is worth",
  );
  assertEqual(
    readyOf(fired, "the tick a torpedo was launched on"),
    false,
    "torpedoReady the tick after a launch, which specs/instrumentation.md " +
      "makes true exactly when the charge is 1",
  );
});
