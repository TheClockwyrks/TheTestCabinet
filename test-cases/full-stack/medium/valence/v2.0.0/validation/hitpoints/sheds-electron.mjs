// Automated validation for the Hit Points sub-item `sheds-electron`.
//
// Each strike strips one electron (one hit point) from an atom. The check poses a
// 5-electron atom under an Emitter and steps the real sim until its electron count
// falls, confirming an atom sheds electrons hit by hit.

import { coverAndSpawn, stepUntil, unitById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hitpoints.sheds-electron");

  const { unitId } = await coverAndSpawn(api, { kind: "emitter", type: "atom", electrons: 5 });
  const e0 = unitById(await api.snapshot(), unitId).electrons;
  check.expectEq("the atom starts at its full electron count", e0, 5);

  const r = await stepUntil(api, (s) => {
    const u = unitById(s, unitId);
    return u != null && u.electrons < e0;
  }, 3, 0.05);
  check.expectOk("the atom sheds an electron under fire", r.hit);
  check.expectLt("its electron count fell", unitById(r.snap, unitId).electrons, e0);

  await liveClip(api, 1300);
  return check.verdict();
}
