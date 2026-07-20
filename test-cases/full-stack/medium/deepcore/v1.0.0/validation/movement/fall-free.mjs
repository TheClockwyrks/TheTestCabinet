// Automated validation for movement.fall-free.
//
// Falling through open tunnel is free: an unsupported miner falls under gravity and pays no
// thrust/drill fuel — only the small passive underground trickle. We drop the miner with no keys
// held and confirm it accelerates downward while fuel barely moves (far less than a thrust burn).

import { newRun, openColumn, solid, TOPSOIL_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("movement.fall-free");
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;

  await newRun(api);
  await api.call("teleport", col, row);
  await openColumn(api, col, row + 1, row + 6);
  await solid(api, col, row + 7);

  const fuel0 = (await api.snapshot()).miner.fuel;
  await api.step(0.5); // free-fall, no keys held
  const snap = await api.snapshot();
  check.expectGt("the miner is falling", snap.miner.vy, 50);
  const fuelDrop = fuel0 - snap.miner.fuel;
  // 0.5s of the underground trickle is ~0.2 fuel; a thrust burn over the same time would be >1.
  check.expectLt("falling itself costs no thrust fuel", fuelDrop, 0.35);

  await liveClip(api, 700);
  return check.verdict();
}
