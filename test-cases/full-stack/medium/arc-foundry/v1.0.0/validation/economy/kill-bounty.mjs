// Automated validation for economy.kill-bounty: destroying a unit pays exactly its bounty in
// Charge the instant it dies (a Mote pays 1).
//
// A strong entry-adjacent tower is armed and a Mote released at the Entry (in range at once);
// the Charge is read before the kill and after — the delta is the Mote's bounty. Measured
// inside the ~0.6 s window before the kept level's own Wave 1 begins, so no other unit dies.

import { armTower, spawnControlled, unitById, snap, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("economy.kill-bounty");

  await armTower(api, { type: "capacitor", tier: 3 }); // one-shots a Wave-1 Mote
  const c0 = (await snap(api)).charge;
  const [u] = await spawnControlled(api, "mote");

  let killed = false;
  for (let i = 0; i < 40; i += 1) {
    await api.step(1 / 60);
    if (!unitById(await snap(api), u.id)) {
      killed = true;
      break;
    }
  }
  const c1 = (await snap(api)).charge;

  check.expectOk("the tower destroyed the unit", killed);
  check.expectEq("the kill paid the Mote's bounty (1 Charge)", c1 - c0, 1);

  await liveClip(api);
  return check.verdict();
}
