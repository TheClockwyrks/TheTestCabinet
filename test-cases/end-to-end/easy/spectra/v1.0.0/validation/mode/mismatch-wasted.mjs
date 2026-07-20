// Automated validation for the base variant's Mode sub-item `mode.mismatch-wasted`.
//
// In Sortie a mismatched (wrong-band) shot is simply wasted: the bullet is consumed
// and the drone is unchanged — still alive, still in formation, neither redirected
// nor otherwise altered. A formation Shard is posed and hit with an opposite-band
// shot; the real collision consumes the shot and leaves the drone exactly as it was.

import { startClean, spawnDrone, findDrone, shootDrone, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("mode.mismatch-wasted");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  await shootDrone(api, id, "magenta"); // opposite the drone's band
  await api.step(0.3); // the shot reaches the drone and is resolved

  const d = findDrone(await api.snapshot(), id);
  check.expectOk("the drone survives the wasted shot", d !== null);
  if (d) {
    check.expectEq("the drone keeps its band", d.band, "cyan");
    check.expectEq("the drone stays in formation (no redirect)", d.phase, "formation");
  }

  await clip(api, 900);
  return check.verdict();
}
