// Automated validation for the Drones sub-item `inversion-trigger`.
//
// A diving Prism that crosses the bottom of the play field unbroken triggers a
// spectral inversion (rather than being destroyed) and returns toward its slot. A
// Prism is driven into a real exit dive to the bottom (see driveInversion); the
// inversion turning on, and the Prism surviving and returning, are read back.

import { driveInversion, findDrone, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("drones.inversion-trigger");

  const r = await driveInversion(api);
  check.expectOk("a Prism reaching the bottom triggers a spectral inversion", r.hit && r.snap.inversionActive);
  const d = r.id != null ? findDrone(r.snap, r.id) : null;
  check.expectOk("the Prism is not destroyed by triggering it", d !== null);
  if (d) {
    check.expectOk(
      "the Prism returns toward its slot after triggering",
      d.phase === "returning" || d.phase === "formation",
    );
  }

  await clip(api, 1800);
  return check.verdict();
}
