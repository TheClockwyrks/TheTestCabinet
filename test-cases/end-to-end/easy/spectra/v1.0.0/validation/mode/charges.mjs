// Automated validation for the overload variant's Mode sub-item `mode.charges`.
//
// In Overload a mismatched (wrong-band) shot no longer wastes: it adds one charge to
// the drone, so successive wrong-band hits advance the charge 0 → 1 → 2. A Shard is
// posed and hit twice with the wrong band; the real charge, read from snapshot(),
// advances each time. The on-drone charge telegraph is captured.

import { startClean, spawnDrone, findDrone, shootDrone, stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("mode.charges");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "shard",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
  });
  check.expectEq("the drone starts uncharged", findDrone(await api.snapshot(), id).charge, 0);

  await shootDrone(api, id, "magenta"); // wrong band
  await stepUntil(api, (s) => (findDrone(s, id)?.charge ?? 0) >= 1, 0.4);
  check.expectEq("the first wrong-band hit charges to 1", findDrone(await api.snapshot(), id).charge, 1);

  await shootDrone(api, id, "magenta"); // wrong band again
  await stepUntil(api, (s) => (findDrone(s, id)?.charge ?? 0) >= 2, 0.4);
  check.expectEq("the second wrong-band hit charges to 2", findDrone(await api.snapshot(), id).charge, 2);

  await api.wait(120);
  await api.screenshot("telegraph");
  return check.verdict();
}
