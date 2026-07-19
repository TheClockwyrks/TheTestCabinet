// Automated validation for the Bonds sub-item `freed-faster`.
//
// An atom freed from a cluster moves faster than the cluster it came from — a lighter
// fragment picks up speed. The check reads a Polymer's base speed, chips it with a
// Cleaver until a free atom is shed, and confirms the freed atom's base speed exceeds
// the cluster's.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bonds.freed-faster");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, "cleaver", g, s0);
  // Spawn upstream so the cluster traverses the tower's full coverage window.
  const id = await spawnAt(api, { type: "polymer", pathId: 0, s: s0 - 50 });
  const clusterSpeed = unitById(await api.snapshot(), id).baseSpeed;

  const r = await stepUntil(api, (s) => s.matter.some((u) => u.type === "atom" && u.id !== id), 6, 0.05);
  check.expectOk("the cluster shed a free atom", r.hit);
  const freed = r.snap.matter.find((u) => u.type === "atom" && u.id !== id);
  check.expectGt("a freed atom moves faster than its parent cluster (baseSpeed)", freed.baseSpeed, clusterSpeed);

  await liveClip(api, 1300);
  return check.verdict();
}
