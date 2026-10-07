// refinement/cost-table — each level costs the Charge REFINEMENT_COSTS gives it.
//
// specs/scrap-press.md fixes the prices: "`REFINEMENT_COSTS` holds the Charge cost
// of reaching each level from the one below it", `20`, `50`, `80`, `110`, `140`,
// `170`, `200`, `230`. specs/economy.md fixes that refining is one of only two
// things Charge is ever spent on, and that "Charge does not accrue interest", so
// between two purchases nothing else may move the bank. specs/instrumentation.md
// fixes the operation: `upgradeQuality` "Buys the next refinement level for
// Charge, as the panel's refinement control does".
//
// The bank is opened with exactly the whole track's price and the run climbs all
// eight rungs one at a time, with the level and the Charge read after each. The
// track is walked whole rather than sampled, because a build with seven right
// prices and one wrong one plays a different economy from the seventh rung on.
// Nothing is on the yard and no wave is running, so nothing but the purchases can
// touch the bank.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { REFINEMENT_COSTS, REFINEMENT_MAX, refinementCost } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  type Harness,
} from "../harness";

/** The whole track's price, so every rung is affordable when it is reached. */
const BANK = REFINEMENT_COSTS.reduce((sum, cost) => sum + cost, 0);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spends exactly the listed cost on each of the eight levels", async () => {
  await openYard(h, { charge: BANK, refinement: 0 });

  let expected = BANK;
  for (let level = 1; level <= REFINEMENT_MAX; level += 1) {
    await h.debug.upgradeQuality();
    expected -= refinementCost(level);

    const s = await h.snapshot();
    assertEqual(s.refinement, level, `the level after buying R${level}`);
    assertEqual(
      s.charge,
      expected,
      `the Charge left after buying R${level} for ${refinementCost(level)} ` +
        `(specs/scrap-press.md)`,
    );
  }

  await h.advance(1);
  await captureStill(h, "costs");

  // The whole track cost exactly the whole table, and not a Charge more.
  assertEqual(
    (await h.snapshot()).charge,
    0,
    "the bank after buying every rung, opened at the table's total",
  );
});
