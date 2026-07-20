// Automated validation for the Drones sub-item `inversion-swap`.
//
// While an inversion is active the two bands are swapped across the whole field:
// every drone and enemy bullet reads as the opposite band, while a player bullet is
// never inverted. A real inversion is triggered (driveInversion); then a
// stored-cyan drone, a cyan enemy bullet, and a cyan player bullet are posed and
// their EFFECTIVE bands read back — the swap is computed by the real systems, not
// fabricated.

import {
  driveInversion,
  spawnDrone,
  findDrone,
  enemyBullets,
  friendlyBullets,
  clip,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("drones.inversion-swap");

  const r = await driveInversion(api);
  check.expectOk("an inversion is active", r.hit && r.snap.inversionActive);

  // Pose a stored-cyan drone and cyan bullets of each kind (no step: read the
  // field-wide swap the active inversion computes right now).
  const cyanDrone = await spawnDrone(api, { kind: "shard", band: "cyan", x: 300, y: 200, phase: "formation" });
  await api.call("spawnEnemyBullet", { x: 400, y: 300, band: "cyan" });
  await api.call("spawnPlayerBullet", { x: 500, y: 400, band: "cyan" });

  const snap = await api.snapshot();
  const d = findDrone(snap, cyanDrone);
  check.expectEq("a stored-cyan drone still stores cyan", d.band, "cyan");
  check.expectEq("a stored-cyan drone reads as magenta under inversion", d.effectiveBand, "magenta");

  const eb = enemyBullets(snap).find((b) => b.band === "cyan");
  check.expectOk("a cyan enemy bullet is on the field", eb !== undefined);
  if (eb) check.expectEq("a cyan enemy bullet reads as magenta under inversion", eb.effectiveBand, "magenta");

  const pb = friendlyBullets(snap).find((b) => b.band === "cyan");
  check.expectOk("a cyan player bullet is on the field", pb !== undefined);
  if (pb) check.expectEq("a player bullet is never inverted", pb.effectiveBand, "cyan");

  await clip(api, 1800);
  return check.verdict();
}
