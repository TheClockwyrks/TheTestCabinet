// Automated validation for the Upgrades sub-item `tier2-bump`.
//
// Upgrading a tower to tier II applies a generic improvement (more range, faster fire,
// more damage) with no branch choice. The check reads an Emitter's stats at tier I,
// upgrades it once, and confirms tier II with no branch and higher stats.

import { startRun, pathGeom, placeCovering, towerById, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("upgrades.tier2-bump");

  const snap = await startRun(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const t = await placeCovering(api, "emitter", g, g.length * 0.18);
  const t1 = towerById(await api.snapshot(), t.id);

  await api.call("upgradeTower", t.id);
  const t2 = towerById(await api.snapshot(), t.id);

  check.expectEq("the tower reaches tier II", t2.tier, 2);
  check.expectEq("tier II commits to no branch yet", t2.branch, null);
  check.expectGt("tier II increases range", t2.range, t1.range);
  check.expectGt("tier II increases damage", t2.damage, t1.damage);
  check.expectGt("tier II increases fire rate", t2.fireRate, t1.fireRate);

  await api.call("selectTower", t.id);
  await api.wait(150);
  await api.screenshot("tier2");
  return check.verdict();
}
