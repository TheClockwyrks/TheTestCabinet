// Automated validation for the Upgrades sub-item `branch-a-vs-b`.
//
// A tower's two tier-III branches behave distinctly. The check compares the Emitter's
// two branches by how many shots a single volley launches at three in-range targets: the
// Spread branch (B) fires at up to three at once, while the Charged branch (A) fires a
// single bolt.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, liveClip, MAP } from "../_helpers.mjs";

async function volleyCount(api, branch) {
  const snap = await startRun(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.2;
  const t = await placeCovering(api, "emitter", g, s0);
  await api.call("upgradeTower", t.id); // -> tier II
  await api.call("upgradeTower", t.id, branch); // -> tier III
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 - 45 });
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 });
  await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 + 45 });
  const r = await stepUntil(api, (s) => s.projectiles.length > 0, 2, 0.02);
  return r.snap.projectiles.length;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("upgrades.branch-a-vs-b");

  const spread = await volleyCount(api, "B"); // SPREAD: up to 3 targets
  const charged = await volleyCount(api, "A"); // CHARGED: a single bolt
  check.expectGt("the Spread branch fires at more targets per volley than Charged", spread, charged);
  check.expectGe("Spread launches multiple shots at once", spread, 2);
  check.expectEq("Charged launches a single shot", charged, 1);

  await liveClip(api, 1000);
  return check.verdict();
}
