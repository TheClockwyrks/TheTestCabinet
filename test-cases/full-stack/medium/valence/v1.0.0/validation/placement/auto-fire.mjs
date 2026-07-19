// Automated validation for the Placement sub-item `auto-fire`.
//
// A built damage tower fires at valid in-range matter with NO manual trigger. The check
// builds an emitter beside the lane and poses a unit in range, then simply steps the
// real sim: the tower acquires the unit and damages it on its own.

import { coverAndSpawn, stepUntil, unitById, towerById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("placement.auto-fire");

  const { unitId, towerId } = await coverAndSpawn(api, { kind: "emitter", type: "atom", electrons: 5 });
  const hp0 = unitById(await api.snapshot(), unitId).hp;

  const r = await stepUntil(api, (s) => {
    const u = unitById(s, unitId);
    return u != null && u.hp < hp0;
  }, 3, 0.1);
  check.expectOk("the tower fires unprompted and damages the unit", r.hit);
  check.expectOk("the tower acquired the in-range unit as its target", towerById(r.snap, towerId).targetId != null);

  await liveClip(api, 1400);
  return check.verdict();
}
