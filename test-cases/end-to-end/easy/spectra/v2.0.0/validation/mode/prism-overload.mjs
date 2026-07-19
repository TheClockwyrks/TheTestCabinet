// Automated validation for the overload variant's Mode sub-item `mode.prism-overload`.
//
// A Prism whose exposed shell is driven to overload emits a two-band burst (one
// cyan, one magenta) and spawns one extra Shard escort. A Prism is posed with its
// shell intact, brought to the brink (setDroneCharge), and tipped over by a real
// mismatched shell hit; the real overload fires the burst and grows the swarm, read
// back from snapshot().

import { startClean, spawnDrone, findDrone, shootDrone, enemyBullets, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("mode.prism-overload");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "prism",
    band: "cyan",
    shellBand: "cyan", // magenta is the wrong band on the shell
    x: 640,
    y: 300,
    phase: "formation",
  });
  await api.call("setDroneCharge", id, 2);
  const before = (await api.snapshot()).drones.length;

  await shootDrone(api, id, "magenta"); // wrong band on the shell -> charges, then overloads
  await api.step(0.1);

  const snap = await api.snapshot();
  const enemies = enemyBullets(snap);
  const bands = new Set(enemies.map((b) => b.band));
  check.expectOk("the overload fires a cyan bullet", bands.has("cyan"));
  check.expectOk("the overload fires a magenta bullet", bands.has("magenta"));
  check.expectGt("the overload spawns an extra escort (the swarm grows)", snap.drones.length, before);
  const prism = findDrone(snap, id);
  check.expectOk("the Prism itself survives the overload", prism !== null && prism.shellAlive === true);
  check.expectOk(
    "the new drone is a Shard escort",
    snap.drones.some((d) => d.id !== id && d.kind === "shard"),
  );

  await clip(api, 1200);
  return check.verdict();
}
