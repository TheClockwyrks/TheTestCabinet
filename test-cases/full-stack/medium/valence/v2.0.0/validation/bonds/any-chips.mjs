// Automated validation for the Bonds sub-item `any-chips`.
//
// A bonded cluster's outer bond pool is chipped by ANY damage type — not only a
// dedicated bond-breaker. The check poses a bonded Polymer under an ENERGY tower
// (Emitter) and steps the real sim: the bond pool must drain, proving an energy tower
// chips bonds too.

import { coverAndSpawn, stepUntil, unitById, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bonds.any-chips");

  const { unitId } = await coverAndSpawn(api, { kind: "emitter", type: "polymer" });
  const u0 = unitById(await api.snapshot(), unitId);
  check.expectOk("the unit starts bonded with a bond pool", u0.traits.bonded && u0.bond > 0);
  const bond0 = u0.bond;

  const r = await stepUntil(api, (s) => {
    const u = unitById(s, unitId);
    return u != null && u.bond != null && u.bond < bond0;
  }, 3, 0.1);
  check.expectOk("an energy tower chips the bond pool (not only a bond-breaker)", r.hit);
  check.expectLt("the bond pool fell under energy fire", unitById(r.snap, unitId).bond, bond0);

  await liveClip(api, 1400);
  return check.verdict();
}
