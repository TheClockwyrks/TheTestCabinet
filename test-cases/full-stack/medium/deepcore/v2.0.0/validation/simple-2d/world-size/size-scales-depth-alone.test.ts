// world-size/size-scales-depth-alone — the size changes the distance and nothing
// else.
//
// specs/world.md: "The size scales only how deep the mine goes. The bands, the
// hazards, the ore mix, the economy, the upgrades, and the rocket are identical
// at every size", and "everything else in this specification that varies with
// depth is expressed as a depth fraction rather than a row, so it is identical in
// shape at every size". This check reads that claim on the PRICES, the half of it
// the specification states as plain figures.
//
// THE PRICES. Fuel at `FUEL_PRICE` an unit and repair at `REPAIR_PRICE` a point
// in `FUEL_BUY_INCREMENT` and `REPAIR_BUY_INCREMENT` lots (specs/expedition.md),
// the first rung of an upgrade track at `UPGRADE_PRICES[0]` (specs/upgrades.md),
// and the first rocket component at its own price (specs/rocket.md). Each is
// bought through the control that stands for the on-screen one, and what is read
// is the Credits it actually took, at every size.
//
// THE ORE MIX IS NOT READ HERE. specs/mining.md draws a vein's ore at the cell's
// depth fraction over the curves' weights, so the mix is a distribution rather
// than a figure, and reading it back off a mine generated at each size measures a
// share of a generated world. The rule the specification does fix about a vein's
// ore — that it sits on a curve open at its own depth — is `ore-depth-curve`, and
// the proportions the draw takes are the reviewer's to judge.
//
// ISOLATION. One expedition per size, with no mine generated under it and the
// miner's body and drill both gated, so nothing walks, falls or cuts while the
// controls are run.

import { afterEach, beforeEach, it } from "vitest";
import {
  FUEL_BUY_INCREMENT,
  FUEL_PRICE,
  REPAIR_BUY_INCREMENT,
  REPAIR_PRICE,
  ROCKET_COMPONENTS,
  UPGRADE_PRICES,
  WORLD_SIZES,
} from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";

/** Enough Credits to run every purchase below without ever being refused. */
const BUDGET = 20000;

/** The track the upgrade price is read on: one that changes no other figure. */
const TRACK = "drill" as const;

/** The four prices, as the specification states them. */
const FUEL_LOT = FUEL_BUY_INCREMENT * FUEL_PRICE;
const REPAIR_LOT = REPAIR_BUY_INCREMENT * REPAIR_PRICE;
/**
 * The rung that takes a track from tier 1 to tier 2.
 *
 * specs/upgrades.md indexes the shared ladder by the tier being LEFT, so the
 * first purchase a fresh expedition can make is the ladder's first entry.
 */
const FIRST_RUNG = UPGRADE_PRICES[0];
const FIRST_COMPONENT = ROCKET_COMPONENTS[0].credits;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every price the same at every size", async () => {
  for (const size of WORLD_SIZES) {
    openScene(h, { size });
    pinMiner(h);
    pinDrill(h);

    // The prices, each read as the Credits its own control actually took.
    h.debug.setCredits(BUDGET);
    h.debug.setFuel(0);
    h.debug.buyFuel();
    const afterFuel = h.snapshot().credits;
    assertEqual(
      BUDGET - afterFuel,
      FUEL_LOT,
      `specs/expedition.md: a lot of fuel costs the same at ${size}`,
    );

    h.debug.setHull(1);
    h.debug.buyRepair();
    const afterRepair = h.snapshot().credits;
    assertEqual(
      afterFuel - afterRepair,
      REPAIR_LOT,
      `specs/expedition.md: a lot of repair costs the same at ${size}`,
    );

    h.debug.buyUpgrade(TRACK);
    const afterUpgrade = h.snapshot().credits;
    assertEqual(
      afterRepair - afterUpgrade,
      FIRST_RUNG,
      `specs/upgrades.md: the first rung costs the same at ${size}`,
    );

    h.debug.fabricate();
    const afterFabricate = h.snapshot();
    assertEqual(
      afterUpgrade - afterFabricate.credits,
      FIRST_COMPONENT,
      `specs/rocket.md: the first rocket component costs the same at ${size}`,
    );
    assertEqual(
      afterFabricate.tiers[TRACK],
      2,
      `specs/upgrades.md: the rung that was paid for was installed at ${size}`,
    );

    h.debug.setPanel("upgrade-shop");
    await h.advance(1);
    captureStill(h, "same");
  }
});
