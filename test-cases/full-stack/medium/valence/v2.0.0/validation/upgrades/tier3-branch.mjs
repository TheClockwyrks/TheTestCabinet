// Automated validation for the Upgrades sub-item `tier3-branch`.
//
// Reaching tier III requires committing to one of two branches; the chosen branch is
// recorded, and an attempt to reach tier III WITHOUT choosing one is refused. The check
// upgrades an Emitter to tier II, confirms a branchless tier-III upgrade is refused, then
// upgrades with a branch and confirms tier III with the branch recorded.

import { startRun, pathGeom, placeCovering, towerById, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("upgrades.tier3-branch");

  const snap = await startRun(api, MAP.single, { energy: 100000 });
  const g = pathGeom(snap.paths[0]);
  const a = await placeCovering(api, "emitter", g, g.length * 0.15);

  await api.call("upgradeTower", a.id); // -> tier II
  const noBranch = await api.call("upgradeTower", a.id); // tier III without a branch
  check.expectOk("reaching tier III without choosing a branch is refused", noBranch === false);
  check.expectEq("the tower stays at tier II", towerById(await api.snapshot(), a.id).tier, 2);

  const ok = await api.call("upgradeTower", a.id, "A");
  check.expectOk("choosing a branch upgrades to tier III", ok === true);
  const t3 = towerById(await api.snapshot(), a.id);
  check.expectEq("the tower is tier III", t3.tier, 3);
  check.expectEq("the chosen branch is recorded", t3.branch, "A");

  await api.call("selectTower", a.id);
  await api.wait(150);
  await api.screenshot("tier3");
  return check.verdict();
}
