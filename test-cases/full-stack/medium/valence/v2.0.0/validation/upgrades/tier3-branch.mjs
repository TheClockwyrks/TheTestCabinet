// Automated validation for the Upgrades sub-item `tier3-branch`.
//
// Reaching tier III requires committing to one of two branches; the chosen branch is
// recorded, and an attempt to reach tier III WITHOUT choosing one is refused. The check
// upgrades an Emitter to tier II, confirms a branchless tier-III upgrade is refused, then
// upgrades with a branch and confirms tier III with the branch recorded.

import {
  startRun,
  pathGeom,
  placeCovering,
  towerById,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let a;
  let noBranch;
  let tierAfterRefusal;
  let ok;
  let t3;

  return {
    id: "upgrades.tier3-branch",

    async arrange(api) {
      const snap = await startRun(api, MAP.single, { energy: 100000 });
      const g = pathGeom(snap.paths[0]);
      a = await placeCovering(api, "emitter", g, g.length * 0.15);
    },

    // Every upgrade attempt is the behavior, so all of them belong here — the refusal
    // included, since "the tower stays at tier II" is read from what it left behind.
    async act(api) {
      await api.call("upgradeTower", a.id); // -> tier II
      noBranch = await api.call("upgradeTower", a.id); // tier III without a branch
      tierAfterRefusal = towerById(await api.snapshot(), a.id).tier;

      ok = await api.call("upgradeTower", a.id, "A");
      t3 = towerById(await api.snapshot(), a.id);

      await api.call("selectTower", a.id);
      await api.settle(150);
      await api.screenshot("tier3");
    },

    async assert(api, check) {
      check.expectOk(
        "reaching tier III without choosing a branch is refused",
        noBranch === false,
      );
      check.expectEq("the tower stays at tier II", tierAfterRefusal, 2);
      check.expectOk("choosing a branch upgrades to tier III", ok === true);
      check.expectEq("the tower is tier III", t3.tier, 3);
      check.expectEq("the chosen branch is recorded", t3.branch, "A");
    },
  };
}
