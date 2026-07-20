// Automated validation for weight.fall-terminal-scales.
//
// Cargo weight raises the terminal fall speed, so a heavy plunge reaches a much higher speed than an
// empty one. In the same long open shaft we drop empty and record the top downward speed, then drop
// with a heavy haul and record it again.

import { openColumn, solid, ROCKBED_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

async function topFallSpeed(api, col, row, seconds) {
  await api.call("teleport", col, row);
  let maxDown = 0;
  const iters = Math.ceil(seconds / 0.1);
  for (let i = 0; i < iters; i += 1) {
    await api.step(0.1);
    const vy = (await api.snapshot()).miner.vy;
    if (vy > maxDown) maxDown = vy;
  }
  return maxDown;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("weight.fall-terminal-scales");
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;

  await api.call("reset", { seed: 1 });
  await api.call("startExpedition", "standard", "standard");
  await openColumn(api, col, row + 1, row + 60);
  await solid(api, col, row + 61);

  const empty = await topFallSpeed(api, col, row, 2.0);
  await api.call("addCargo", "pyronium", 5); // ~290 kg
  const heavy = await topFallSpeed(api, col, row, 2.0);

  check.expectGt("an empty miner reaches its fall terminal", empty, 700);
  check.expectGt("a heavy haul falls much faster", heavy, empty + 150);

  await liveClip(api, 600);
  return check.verdict();
}
