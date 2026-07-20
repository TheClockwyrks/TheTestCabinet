// Automated validation for hazards.gas-ignores-radiator.
//
// Unlike lava, a gas detonation is NOT reduced by the radiator — hull is the only counter to gas.
// We detonate the same gas pocket once with the lowest radiator tier and once with the highest,
// each with a high hull so both are survivable and the full damage registers, and confirm the hull
// loss is the same either way.

import { K, newRun, standAt, SPAWN_COL, ROCKBED_ROW, stepUntil, liveClip } from "../_helpers.mjs";

async function gasHullLoss(api, col, row, radiatorTier) {
  await standAt(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "gas" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await api.call("teleport", col, row);
  await api.call("grantGear", { hull: 5, radiator: radiatorTier }); // 450 hull, refilled
  const hull0 = (await api.snapshot()).miner.hull;
  await api.call("keyDown", K.down);
  const r = await stepUntil(api, (s) => s.miner.hull < hull0, 3, 0.05);
  await api.call("keyUp", K.down);
  return hull0 - r.snap.miner.hull;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.gas-ignores-radiator");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  const bare = await gasHullLoss(api, col, row, 1); // no radiator
  const shielded = await gasHullLoss(api, col, row, 5); // 80% radiator — irrelevant to gas

  check.expectGt("a gas detonation costs real hull", bare, 40);
  check.expectLt("the radiator does NOT reduce gas (same loss both tiers)", Math.abs(bare - shielded), 1);

  await liveClip(api, 500);
  return check.verdict();
}
