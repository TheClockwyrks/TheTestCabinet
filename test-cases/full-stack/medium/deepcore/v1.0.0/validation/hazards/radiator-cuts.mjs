// Automated validation for hazards.radiator-cuts.
//
// A higher radiator tier reduces hazard damage. We stand the miner in lava with the lowest radiator
// tier and again with the highest, reading the hull drop over the same half second.

import { newRun, SPAWN_COL, DEEPSTONE_ROW, liveClip } from "../_helpers.mjs";

async function lavaLoss(api, col, row, radiatorTier) {
  await api.call("teleport", col, row);
  await api.call("setTile", col, row + 1, { kind: "lava" });
  await api.call("teleport", col, row);
  await api.call("grantGear", { hull: 5, radiator: radiatorTier }); // hull 450, refilled
  const hull0 = (await api.snapshot()).miner.hull;
  await api.step(0.5);
  return hull0 - (await api.snapshot()).miner.hull;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.radiator-cuts");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await newRun(api);
  const bare = await lavaLoss(api, col, row, 1); // no reduction
  const shielded = await lavaLoss(api, col, row, 5); // 80% reduction

  check.expectGt("bare plating takes real lava damage", bare, 8);
  check.expectLt("a top radiator cuts the damage sharply", shielded, bare * 0.5);

  await liveClip(api, 600);
  return check.verdict();
}
