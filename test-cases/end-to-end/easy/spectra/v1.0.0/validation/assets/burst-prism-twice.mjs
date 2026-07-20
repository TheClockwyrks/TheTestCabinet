// Automated validation for the Provided-art sub-item `burst-prism-twice`.
//
// A Prism plays the drone-burst twice — once when its shell breaks and once when
// its core is destroyed. A Prism is posed and broken in two real hits; the live
// burst count (snapshot.bursts) is read to confirm a pop spawns for each break.

import { startClean, spawnDrone, findDrone, shootDrone, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("assets.burst-prism-twice");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "prism",
    band: "cyan",
    shellBand: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  check.expectEq("no burst before any pop", (await api.snapshot()).bursts.length, 0);

  // Break the shell (its band): the first pop.
  await shootDrone(api, id, "cyan");
  await api.step(0.03);
  const afterShell = (await api.snapshot()).bursts.length;
  check.expectGe("breaking the shell plays a burst", afterShell, 1);

  // Break the core (the opposite band): the second pop, coexisting with the first.
  await shootDrone(api, id, "magenta");
  await api.step(0.03);
  const snap = await api.snapshot();
  check.expectGe("destroying the core plays a second burst", snap.bursts.length, 2);
  check.expectEq("the Prism is gone after the core kill", findDrone(snap, id), null);

  // A live clip of a Prism popping twice.
  await startClean(api);
  const id2 = await spawnDrone(api, { kind: "prism", band: "cyan", shellBand: "cyan", x: 640, y: 300, phase: "formation" });
  await api.call("spawnPlayerBullet", { x: 640, y: 540, band: "cyan" });
  await clip(api, 700);
  await shootDrone(api, id2, "magenta");
  await clip(api, 700);

  return check.verdict();
}
