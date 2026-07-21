// Automated validation for the Upgrades sub-item `tier2-bump`.
//
// Upgrading a tower to tier II applies a generic improvement (more range, faster fire,
// more damage) with no branch choice. The check reads an Emitter's stats at tier I,
// upgrades it once, and confirms tier II with no branch and higher stats.

import {
  startRun,
  pathGeom,
  placeCovering,
  towerById,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let t;
  let t1;
  let t2;

  return {
    id: "upgrades.tier2-bump",

    async arrange(api) {
      const snap = await startRun(api, MAP.single, { energy: 100000 });
      const g = pathGeom(snap.paths[0]);
      t = await placeCovering(api, "emitter", g, g.length * 0.18);
      t1 = towerById(await api.snapshot(), t.id);
    },

    // The upgrade itself is the behavior under test; selecting the tower afterwards is
    // what puts its new stats on screen for the still. `settle` is a real repaint pause in
    // both passes, so the panel has actually been drawn when it is captured.
    async act(api) {
      await api.call("upgradeTower", t.id);
      t2 = towerById(await api.snapshot(), t.id);

      await api.call("selectTower", t.id);
      await api.settle(150);
      await api.screenshot("tier2");
    },

    async assert(api, check) {
      check.expectEq("the tower reaches tier II", t2.tier, 2);
      check.expectEq("tier II commits to no branch yet", t2.branch, null);
      check.expectGt("tier II increases range", t2.range, t1.range);
      check.expectGt("tier II increases damage", t2.damage, t1.damage);
      check.expectGt("tier II increases fire rate", t2.fireRate, t1.fireRate);
    },
  };
}
