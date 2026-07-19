// Automated validation for the Swarm sub-item `only-divers-fire`.
//
// Drones in formation never fire; only diving drones do. An assembled formation is
// posed and held with no dive (before the automatic assault's first dive at ~2.0s)
// — the real fire systems produce zero enemy bullets — then a REAL dive is launched
// and enemy bullets appear.

import { startStageClean, spawnDrone, enemyBullets, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("swarm.only-divers-fire");

  await startStageClean(api, 1);
  await api.call("setShipX", 640);
  const ids = [];
  for (const [x, band] of [[500, "cyan"], [640, "magenta"], [780, "cyan"]]) {
    ids.push(await spawnDrone(api, { kind: "shard", band, x, y: 200, phase: "formation" }));
  }

  // Hold the formation short of the first automatic dive (~2.0s after assembly):
  // formation drones must not fire.
  await api.step(1.8);
  check.expectEq(
    "an all-formation swarm fires no enemy bullets",
    enemyBullets(await api.snapshot()).length,
    0,
  );

  // Now send one drone into a real dive: enemy bullets appear.
  await api.call("forceDive", ids[0]);
  let fired = false;
  for (let i = 0; i < 100 && !fired; i += 1) {
    await api.step(0.02);
    if (enemyBullets(await api.snapshot()).length > 0) fired = true;
  }
  check.expectOk("a diving drone does fire", fired);

  await clip(api, 1400);
  return check.verdict();
}
