// Automated validation for the Hit Points sub-item `leak-remaining`.
//
// An atom that reaches the collector costs integrity equal to its REMAINING electrons,
// so a smaller (more-stripped) atom costs less than a full one — partial damage still
// helps. The check leaks a 4-electron and a 2-electron atom (no towers, so nothing
// alters them mid-flight) and confirms each costs its electron count, the smaller less.

import { startRun, pathGeom, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

async function leakCost(api, electrons) {
  const snap = await startRun(api, MAP.single, { integrity: 100000 });
  const g = pathGeom(snap.paths[0]);
  const id = await spawnAt(api, { type: "atom", electrons, pathId: 0, s: g.length - 20 });
  const int0 = (await api.snapshot()).integrity;
  const r = await stepUntil(api, (s) => unitById(s, id) == null, 3, 0.05);
  return { cost: int0 - r.snap.integrity, hit: r.hit };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hitpoints.leak-remaining");

  const full = await leakCost(api, 4);
  const small = await leakCost(api, 2);
  check.expectOk("the full atom leaked", full.hit);
  check.expectEq("a 4-electron atom costs 4 integrity", full.cost, 4);
  check.expectEq("a 2-electron atom costs 2 integrity", small.cost, 2);
  check.expectLt("a smaller (more-stripped) atom costs less integrity", small.cost, full.cost);

  // Clip a unit leaking.
  const snap = await startRun(api, MAP.single, { integrity: 100000 });
  const g = pathGeom(snap.paths[0]);
  await spawnAt(api, { type: "atom", electrons: 4, pathId: 0, s: g.length - 60 });
  await liveClip(api, 1400);
  return check.verdict();
}
