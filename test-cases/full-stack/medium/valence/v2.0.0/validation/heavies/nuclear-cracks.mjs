// Automated validation for the Heavies sub-item `nuclear-cracks`.
//
// Nuclear damage (the Reactor) cracks a heavy isotope — its hit points fall under
// nuclear fire. The check poses a heavy under a Reactor and steps until its hit points
// drop.

import { coverAndSpawn, stepUntil, unitById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heavies.nuclear-cracks");

  const { unitId } = await coverAndSpawn(api, { kind: "reactor", type: "isotope" });
  const hp0 = unitById(await api.snapshot(), unitId).hp;

  const r = await stepUntil(api, (s) => {
    const u = unitById(s, unitId);
    return u == null || u.hp < hp0;
  }, 4, 0.05);
  check.expectOk("nuclear damage cracks the heavy (hp drops)", r.hit);

  await liveClip(api, 1200);
  return check.verdict();
}
