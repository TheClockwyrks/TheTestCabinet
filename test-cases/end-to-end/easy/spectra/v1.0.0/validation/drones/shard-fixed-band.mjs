// Automated validation for the Drones sub-item `shard-fixed-band`.
//
// A Shard keeps a single fixed band for its whole life; it never changes. A Shard
// is posed and the real simulation stepped across several seconds; its band is read
// back at each sample and must never change.

import { startClean, spawnDrone, findDrone, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("drones.shard-fixed-band");

  await startClean(api);
  await api.call("setLives", 9); // avoid a game-over from its own dives during the sweep
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 200,
    phase: "formation",
  });
  check.expectEq("the Shard starts on its band", findDrone(await api.snapshot(), id).band, "cyan");

  let everChanged = false;
  let samples = 0;
  for (let i = 0; i < 10; i += 1) {
    await api.step(0.5);
    const d = findDrone(await api.snapshot(), id);
    if (!d) break;
    samples += 1;
    if (d.band !== "cyan") everChanged = true;
  }
  check.expectGt("the Shard persisted across the sweep", samples, 4);
  check.expectOk("the Shard never changed band", everChanged === false);

  await clip(api, 1200);
  return check.verdict();
}
