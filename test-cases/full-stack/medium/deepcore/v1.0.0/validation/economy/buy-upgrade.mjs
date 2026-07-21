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

    // A funded miner still on tier 1 of every track.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 1000);
      before = await api.snapshot();
    },

    // The purchase IS the behavior under test, so it happens here and the clip shows it land.
    async act(api) {
      await api.call("buyUpgrade", "fuel");
      after = await api.snapshot();
      await api.advance(30); // 30 ticks = 0.5 s, the old 500 ms clip tail
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
    },
  };
}
