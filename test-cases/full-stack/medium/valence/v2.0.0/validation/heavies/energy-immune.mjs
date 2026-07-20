// Automated validation for the Heavies sub-item `energy-immune`.
//
// A heavy isotope is immune to energy damage: an energy tower cannot even target it, and
// its hit points stay untouched. The check poses a heavy under an Emitter (energy),
// steps the real sim, and confirms the heavy's hit points are unchanged and the tower
// never acquires it.

import { coverAndSpawn, unitById, towerById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("heavies.energy-immune");

  const { unitId, towerId } = await coverAndSpawn(api, { kind: "emitter", type: "isotope" });
  const hp0 = unitById(await api.snapshot(), unitId).hp;
  await api.step(2);
  const now = await api.snapshot();
  const u = unitById(now, unitId);

  check.expectOk("the heavy is still alive", u != null);
  check.expectEq("an energy tower cannot damage a heavy (hp unchanged)", u.hp, hp0);
  check.expectEq("the energy tower never even targets the heavy", towerById(now, towerId).targetId, null);

  await liveClip(api, 1200);
  return check.verdict();
}
