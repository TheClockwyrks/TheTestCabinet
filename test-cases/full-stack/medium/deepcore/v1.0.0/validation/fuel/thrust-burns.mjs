// Automated validation for fuel.thrust-burns.
//
// Holding thrust burns fuel while it lifts the miner. We open a shaft above, hold thrust, run the
// real sim forward, and confirm the miner rises while fuel drops far more than the passive trickle.

import { K, newRun, openColumn, solid, ROCKBED_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fuel.thrust-burns");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await openColumn(api, col, row - 4, row - 1); // open above so the miner can climb
  await solid(api, col, row + 1);
  await api.call("teleport", col, row);
  await api.call("setFuel", 999); // top off (clamped to max)

  const fuel0 = (await api.snapshot()).miner.fuel;
  await api.call("keyDown", K.thrust);
  await api.step(0.5);
  const snap = await api.snapshot();
  await api.call("keyUp", K.thrust);

  check.expectLt("thrust lifts the miner upward", snap.miner.vy, 0);
  check.expectGt("thrust burns real fuel", fuel0 - snap.miner.fuel, 1.5);

  await liveClip(api, 700);
  return check.verdict();
}
