// Automated validation for economy.buy-upgrade.
//
// Buying the next tier on a track deducts its pinned price, raises the tier, and grants the new
// capacity. We fund the miner and buy a fuel-tank tier, reading Credits, tier, and max fuel back.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "economy.buy-upgrade",

    // A funded miner still on tier 1 of every track, with its tank deliberately PART FULL.
    //
    // The starting tank is full, and at full the two wrong readings of a tank purchase are
    // indistinguishable from the right one: "adds the new capacity" and "fills to full" both land
    // on `175/175`. Posing `30/100` first — the worked example in `specs/upgrades.md` — separates
    // all three, since the rule puts the tank at `105/175`: not `30` (capacity granted but no fuel
    // with it) and not `175` (a free fill the spec explicitly denies).
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 1000);
      await api.call("setFuel", 30);
      before = await api.snapshot();
    },

    // The purchase IS the behavior under test, so it happens here and the clip shows it land.
    //
    // A purchase is instant, so the beat before it is what gives the clip a "before": the funded
    // balance and the tier-1 fuel gauge on screen, then the deduction and the longer tank after.
    // Without it the clip opens on the post-purchase state and shows no transaction at all.
    async act(api) {
      await api.advance(45); // 45 ticks = 0.75 s on the funded balance and the tier-1 tank
      await api.call("buyUpgrade", "fuel");
      after = await api.snapshot();
      await api.advance(90); // 90 ticks = 1.5 s on the deducted balance and the larger tank
    },

    async assert(api, check) {
      check.expectEq("starts at fuel tier 1", before.tiers.fuel, 1);
      check.expectEq(
        "the tier-1→2 price is deducted",
        before.credits - after.credits,
        300,
      );
      check.expectEq("the fuel tier rises", after.tiers.fuel, 2);
      check.expectGt(
        "max fuel rises with the tier",
        after.miner.maxFuel,
        before.miner.maxFuel,
      );
      // A bigger tank "adds the capacity increase to your current fuel immediately"
      // (`specs/upgrades.md`), so the fuel gained is exactly the capacity gained. Checking only
      // that the MAXIMUM rose accepted a build that moved the ceiling and left the tank where it
      // was — a purchase that buys nothing usable until you also pay the Fuel Depot.
      check.expectEq(
        "the added capacity is granted as usable fuel",
        after.miner.fuel - before.miner.fuel,
        after.miner.maxFuel - before.miner.maxFuel,
      );
      // ...and it is "not a free fill to full": the rest of the tank is still bought at the Depot.
      check.expectLt(
        "buying a tank is not a free fill to full",
        after.miner.fuel,
        after.miner.maxFuel,
      );
    },
  };
}
