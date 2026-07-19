// Automated validation for the overload variant's Mode sub-item `mode.flux-overload`.
//
// A Flux driven to overload flips its band and fires a three-shot spread in its new
// band. A Flux is posed in a held window, brought to the brink (setDroneCharge), and
// tipped over by a real mismatched shot; the real overload flips its band and fires
// the spread, both read back from snapshot().

import { startClean, spawnDrone, findDrone, shootDrone, enemyBullets, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("mode.flux-overload");

  await startClean(api);
  const id = await spawnDrone(api, {
    kind: "flux",
    band: "cyan",
    x: 640,
    y: 300,
    phase: "formation",
    fluxClock: 0, // held on cyan
  });
  await api.step(0.02); // settle into the held window (not shimmering)
  check.expectOk("the Flux is held (chargeable)", findDrone(await api.snapshot(), id).shimmer === false);
  await api.call("setDroneCharge", id, 2);

  await shootDrone(api, id, "magenta"); // wrong band while held -> charges, then overloads
  await api.step(0.1);

  const d = findDrone(await api.snapshot(), id);
  const enemies = enemyBullets(await api.snapshot());
  check.expectOk("the overloaded Flux is still on the field", d !== null);
  if (d) check.expectEq("the overloaded Flux flips to the new band", d.band, "magenta");
  check.expectEq("the overload fires a three-shot spread", enemies.length, 3);
  check.expectOk("the spread is in the new band", enemies.every((b) => b.band === "magenta"));

  await clip(api, 1000);
  return check.verdict();
}
