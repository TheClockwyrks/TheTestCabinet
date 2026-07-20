// Automated validation for economy.buy-upgrade.
//
// Buying the next tier on a track deducts its pinned price, raises the tier, and grants the new
// capacity. We fund the miner and buy a fuel-tank tier, reading Credits, tier, and max fuel back.

import { newRun, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.buy-upgrade");

  await newRun(api);
  await api.call("grantCredits", 1000);
  const before = await api.snapshot();
  check.expectEq("starts at fuel tier 1", before.tiers.fuel, 1);

  await api.call("buyUpgrade", "fuel");
  const after = await api.snapshot();
  check.expectEq("the tier-1→2 price is deducted", before.credits - after.credits, 300);
  check.expectEq("the fuel tier rises", after.tiers.fuel, 2);
  check.expectGt("max fuel rises with the tier", after.miner.maxFuel, before.miner.maxFuel);

  await liveClip(api, 500);
  return check.verdict();
}
