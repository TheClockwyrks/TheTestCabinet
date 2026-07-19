// Automated validation for the Hit Points sub-item `neutralize-pays`.
//
// Neutralizing a unit pays energy (and score) equal to its bounty. The check poses a
// 3-electron atom (bounty 4) at the upstream edge of an Emitter's range so it travels the
// tower's full in-range window (the dwell needed to fully neutralize it), records energy
// and score, steps until the unit is neutralized, and confirms both rose by exactly its
// bounty.

import { coverAndPassThrough, stepUntil, unitById, liveClip } from "../_helpers.mjs";

const ATOM3_BOUNTY = 4; // atomBounty(3) — specs/matter.md

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hitpoints.neutralize-pays");

  const { unitId } = await coverAndPassThrough(api, { kind: "emitter", type: "atom", electrons: 3 });
  const s0 = await api.snapshot();
  const energy0 = s0.energy;
  const score0 = s0.score;

  const r = await stepUntil(api, (s) => unitById(s, unitId) == null, 8, 0.05);
  check.expectOk("the unit was neutralized", r.hit);
  check.expectEq("neutralizing pays its bounty in energy", r.snap.energy - energy0, ATOM3_BOUNTY);
  check.expectEq("...and the same in score", r.snap.score - score0, ATOM3_BOUNTY);

  await liveClip(api, 1200);
  return check.verdict();
}
