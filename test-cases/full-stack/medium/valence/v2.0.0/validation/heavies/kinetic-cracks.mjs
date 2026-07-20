// Automated validation for the Heavies sub-item `kinetic-cracks`.
//
// Kinetic damage (the Cleaver) cracks a heavy isotope — its hit points fall under
// kinetic fire. The check poses a heavy under a Cleaver and steps until its hit points
// drop.

import { coverAndSpawn, stepUntil, unitById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heavies.kinetic-cracks");

  const { unitId } = await coverAndSpawn(api, { kind: "cleaver", type: "isotope" });
  const hp0 = unitById(await api.snapshot(), unitId).hp;

  const r = await stepUntil(api, (s) => {
    const u = unitById(s, unitId);
    return u == null || u.hp < hp0;
  }, 3, 0.05);
  check.expectOk("kinetic damage cracks the heavy (hp drops)", r.hit);

  await liveClip(api, 1200);
  return check.verdict();
}
