// Automated validation for hazards.lava-drains.
//
// Touching lava drains hull quickly. We stand the miner on a lava tile and step the real sim,
// reading the hull drop over half a second (no radiator).

import { newRun, SPAWN_COL, DEEPSTONE_ROW, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hazards.lava-drains");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await api.call("setTile", col, row + 1, { kind: "lava" }); // lava underfoot
  await api.call("teleport", col, row);
  const hull0 = (await api.snapshot()).miner.hull;

  await api.step(0.5);
  const snap = await api.snapshot();
  check.expectLt("lava drains hull", snap.miner.hull, hull0);
  check.expectGt("lava drains hull fast", hull0 - snap.miner.hull, 5);

  await liveClip(api, 600);
  return check.verdict();
}
