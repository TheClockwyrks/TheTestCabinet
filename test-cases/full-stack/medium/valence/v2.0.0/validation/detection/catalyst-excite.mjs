// Automated validation for the Detection sub-item `catalyst-excite`.
//
// Matter in a Catalyst's field is excited — it takes extra damage per hit while in the
// aura. The check poses an atom in a Catalyst's field, steps one tick for the aura to
// apply, and reads the unit's positive `damageBonus`.

import { coverAndSpawn, unitById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("detection.catalyst-excite");

  const { unitId } = await coverAndSpawn(api, { kind: "catalyst", type: "atom", electrons: 4 });
  await api.step(0.05);
  const u = unitById(await api.snapshot(), unitId);

  check.expectGe("matter in a Catalyst field is excited (+damage per hit)", u.damageBonus, 1);

  await liveClip(api, 1000);
  return check.verdict();
}
