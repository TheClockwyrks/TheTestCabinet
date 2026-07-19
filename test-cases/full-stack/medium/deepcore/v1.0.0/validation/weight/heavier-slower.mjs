// Automated validation for weight.heavier-slower.
//
// A heavy cargo load has a lower climb top speed than an empty miner. In the same open shaft we
// climb empty and record the top upward speed, then climb with a heavy (non-overloaded) haul and
// record it again. The heavy climb tops out clearly slower.

import { K, openColumn, solid, DEEPSTONE_ROW, SPAWN_COL, liveClip } from "../_helpers.mjs";

async function topClimbSpeed(api, col, row, seconds) {
  await api.call("teleport", col, row);
  await api.call("setFuel", 999);
  await api.call("keyDown", K.thrust);
  let maxUp = 0;
  const iters = Math.ceil(seconds / 0.1);
  for (let i = 0; i < iters; i += 1) {
    await api.step(0.1);
    const up = -(await api.snapshot()).miner.vy;
    if (up > maxUp) maxUp = up;
  }
  await api.call("keyUp", K.thrust);
  return maxUp;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("weight.heavier-slower");
  const col = SPAWN_COL;
  const row = DEEPSTONE_ROW;

  await api.call("reset", { seed: 1 });
  await api.call("startExpedition", "standard", "standard");
  await openColumn(api, col, row - 45, row - 1);
  await solid(api, col, row + 1);

  const empty = await topClimbSpeed(api, col, row, 1.5);
  await api.call("addCargo", "pyronium", 5); // ~290 kg — heavy but under the tier-1 lift limit
  const heavy = await topClimbSpeed(api, col, row, 1.5);

  check.expectGt("an empty miner climbs fast", empty, 700);
  check.expectLt("a heavy haul tops out slower", heavy, empty - 150);

  await liveClip(api, 600);
  return check.verdict();
}
