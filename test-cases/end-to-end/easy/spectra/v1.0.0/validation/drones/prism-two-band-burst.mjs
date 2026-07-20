// Automated validation for the Drones sub-item `prism-two-band-burst`.
//
// A diving Prism fires a two-band burst — one cyan and one magenta bullet — so it
// threatens you whichever band you shield as. A Prism is posed, sent into a REAL
// dive, and stepped forward; the enemy bullets it fires are read from snapshot()
// and must include both bands.

import { startClean, spawnDrone, findDrone, enemyBullets, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("drones.prism-two-band-burst");

  await api.reset({ seed: 1 });
  await api.call("startGame");
  await api.call("clearField");
  await api.call("setShipX", 640);
  const id = await spawnDrone(api, {
    kind: "prism",
    band: "cyan",
    shellBand: "cyan",
    x: 640,
    y: 200,
    phase: "formation",
  });
  await api.step(0.05);
  await api.call("forceDive", id);

  // Collect the bands of enemy bullets fired across the dive.
  const seen = new Set();
  for (let i = 0; i < 150; i += 1) {
    await api.step(0.02);
    const s = await api.snapshot();
    for (const b of enemyBullets(s)) seen.add(b.band);
    const d = findDrone(s, id);
    if (!d) break;
    if (seen.has("cyan") && seen.has("magenta")) break;
  }
  check.expectOk("the diving Prism fires a cyan bullet", seen.has("cyan"));
  check.expectOk("the diving Prism fires a magenta bullet", seen.has("magenta"));

  // A live clip of a Prism dive.
  await api.reset({ seed: 1 });
  await api.call("startGame");
  await api.call("clearField");
  const id2 = await spawnDrone(api, { kind: "prism", band: "cyan", shellBand: "cyan", x: 640, y: 200, phase: "formation" });
  await api.step(0.05);
  await api.call("forceDive", id2);
  await clip(api, 1600);

  return check.verdict();
}
