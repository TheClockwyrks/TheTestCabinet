// Automated validation for hazards.gas-scales-depth.
//
// A gas detonation deep in the coreshell deals far more hull damage than one in the shallow
// rockbed. We detonate a gas pocket at each depth with a high hull (so both are survivable and the
// full damage registers) and the same tier-1 radiator, and compare the hull dropped.

import { K, newRun, standAt, SPAWN_COL, ROCKBED_ROW, CORESHELL_ROW, stepUntil } from "../_helpers.mjs";

async function gasHullLoss(api, col, row) {
  await standAt(api, col, row);
  await api.call("setTile", col, row + 1, { kind: "gas" });
  await api.call("setTile", col, row + 2, { kind: "rock" });
  await api.call("teleport", col, row);
  await api.call("grantGear", { hull: 5 }); // 450 max hull, refilled; radiator stays tier 1 (no cut)
  const hull0 = (await api.snapshot()).miner.hull;
  await api.call("keyDown", K.down);
  const r = await stepUntil(api, (s) => s.miner.hull < hull0, 3, 0.05);
  await api.call("keyUp", K.down);
  return hull0 - r.snap.miner.hull;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.gas-scales-depth");
  const col = SPAWN_COL;

  await newRun(api);
  const shallow = await gasHullLoss(api, col, ROCKBED_ROW);
  const deep = await gasHullLoss(api, col, CORESHELL_ROW);

  check.expectGt("a shallow gas pocket costs hull", shallow, 5);
  check.expectGt("a deep gas pocket costs far more", deep, 40);
  check.expectGt("gas damage scales with depth", deep, shallow * 1.8);

  await api.call("setAutoStep", true);
  await api.wait(600);
  return check.verdict();
}
