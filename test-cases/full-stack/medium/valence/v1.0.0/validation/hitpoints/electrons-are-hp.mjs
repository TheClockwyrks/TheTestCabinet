// Automated validation for the Hit Points sub-item `electrons-are-hp`.
//
// An atom's electron count is its hit points, so a bigger atom takes more hits to
// neutralize. The check times how long an identical Emitter takes to neutralize a
// 1-electron atom versus a 6-electron atom and confirms the larger one takes longer.
// Each atom is posed at the upstream edge of the tower's range (coverAndPassThrough) so
// it travels the tower's full in-range window — the dwell a 6-electron atom needs to be
// worn all the way down by one tower.

import { coverAndPassThrough, stepUntil, unitById, liveClip, pathGeom, placeCovering, spawnAt, firstInRange, towerById, startRun, MAP } from "../_helpers.mjs";

async function timeToKill(api, electrons) {
  const { unitId } = await coverAndPassThrough(api, { kind: "ionizer", type: "atom", electrons });
  const r = await stepUntil(api, (s) => unitById(s, unitId) == null, 12, 0.05);
  return { t: r.snap.simTime, hit: r.hit };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hitpoints.electrons-are-hp");

  const small = await timeToKill(api, 1);
  const big = await timeToKill(api, 6);
  check.expectOk("the small atom was neutralized", small.hit);
  check.expectOk("the large atom was neutralized", big.hit);
  check.expectGt("a 6-electron atom takes longer to neutralize than a 1-electron one", big.t, small.t);

  // Clip an atom being stripped down.
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, "ionizer", g, g.length * 0.5);
  const s = firstInRange(g, towerById(await api.snapshot(), tower.id));
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s });
  await liveClip(api, 1300);
  return check.verdict();
}
