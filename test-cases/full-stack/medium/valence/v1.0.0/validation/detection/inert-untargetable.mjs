// Automated validation for the Detection sub-item `inert-untargetable`.
//
// Inert matter is untargetable until a detector reveals it. The check poses an inert
// Noble under an Emitter (no detector present), steps the real sim, and confirms the
// noble stays unrevealed and untouched and the tower never acquires it.

import { coverAndSpawn, unitById, towerById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("detection.inert-untargetable");

  const { unitId, towerId } = await coverAndSpawn(api, { kind: "emitter", type: "noble" });
  const hp0 = unitById(await api.snapshot(), unitId).hp;
  await api.step(2);
  const now = await api.snapshot();
  const u = unitById(now, unitId);

  check.expectOk("the inert unit is still alive", u != null);
  check.expectEq("the inert unit is unrevealed", u.revealed, false);
  check.expectEq("an undetected inert unit is untouched (hp unchanged)", u.hp, hp0);
  check.expectEq("the tower never targets the undetected inert unit", towerById(now, towerId).targetId, null);

  await liveClip(api, 1200);
  return check.verdict();
}
