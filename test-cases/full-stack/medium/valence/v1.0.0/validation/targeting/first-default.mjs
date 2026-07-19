// Automated validation for the Targeting sub-item `first-default`.
//
// By default a damage tower fires at the FIRST target — the valid in-range unit furthest
// along its path. The check poses three real atoms at increasing progress in a Beam's
// range and, after one real step, reads which one the tower acquired: the furthest along.

import { startRun, pathGeom, placeCovering, spawnAt, liveClip, towerById, FIXED, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.first-default");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.2;
  const t = await placeCovering(api, "beam", g, s0);
  await spawnAt(api, { type: "atom", electrons: 4, pathId: 0, s: s0 - 120 });
  await spawnAt(api, { type: "atom", electrons: 4, pathId: 0, s: s0 });
  const front = await spawnAt(api, { type: "atom", electrons: 4, pathId: 0, s: s0 + 120 });

  await api.step(FIXED);
  check.expectEq("the default target is the unit furthest along the path", towerById(await api.snapshot(), t.id).targetId, front);

  await liveClip(api, 1200);
  return check.verdict();
}
