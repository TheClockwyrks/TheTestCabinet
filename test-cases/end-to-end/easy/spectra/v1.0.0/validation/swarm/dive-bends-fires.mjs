// Automated validation for the Swarm sub-item `dive-bends-fires`.
//
// A diving drone leaves the formation, bends its path toward the player's x as it
// descends, and fires while diving. A formation drone is posed off to one side and
// the ship parked at the far side; a REAL dive is launched (forceDive) and stepped
// forward — its x is read trending toward the ship, and its real fire is read as an
// enemy bullet appearing.

import {
  startClean,
  spawnDrone,
  findDrone,
  enemyBullets,
  stepUntil,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("swarm.dive-bends-fires");

  await startClean(api);
  await api.call("setShipX", 300); // far to the left of the drone
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 900,
    y: 200,
    phase: "formation",
  });
  await api.step(0.05); // let the formation register (arms the dive systems)
  const startX = findDrone(await api.snapshot(), id).x;
  await api.call("forceDive", id);
  check.expectEq("the drone enters a dive", findDrone(await api.snapshot(), id).phase, "diving");

  // Step the dive forward, tracking the closest the drone gets to the ship and
  // whether it fires.
  let minX = startX;
  let firedEnemy = false;
  for (let i = 0; i < 130; i += 1) {
    await api.step(0.02);
    const s = await api.snapshot();
    const d = findDrone(s, id);
    if (d && d.phase === "diving") minX = Math.min(minX, d.x);
    if (enemyBullets(s).length > 0) firedEnemy = true;
    if (d && d.phase !== "diving") break;
  }
  check.expectLt("the dive bends toward the player's x", minX, startX - 100);
  check.expectOk("the diver fires while diving", firedEnemy);

  // A live clip of a dive.
  await startClean(api);
  await api.call("setShipX", 300);
  const id2 = await spawnDrone(api, { kind: "shard", band: "magenta", x: 900, y: 200, phase: "formation" });
  await api.step(0.05);
  await api.call("forceDive", id2);
  await clip(api, 1600);

  return check.verdict();
}
