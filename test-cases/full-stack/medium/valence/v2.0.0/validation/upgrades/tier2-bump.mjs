// Automated validation for the Upgrades sub-item `tier2-bump`.
//
// Upgrading a tower to tier II applies a generic improvement (more range, faster fire,
// more damage) with no branch choice. The check reads an Emitter's stats at tier I,
// upgrades it once, and confirms tier II with no branch and higher stats.
//
// The evidence is a PLAYBACK, not a still. The numbers this item is about — range, damage,
// fire rate — only mean something as a change, and a photograph of the inspector showing
// tier II says nothing about what it read a moment earlier. So the tower is selected FIRST,
// its tier-I stats are held on screen, the upgrade is applied, and the tier-II stats are
// held the same way: the reviewer watches the panel change.

import {
  startRun,
  pathGeom,
  placeCovering,
  towerById,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let t;
  let t1;
  let t2;

  return {
    id: "upgrades.tier2-bump",

    clipMs: clipBudget(LEAD_TICKS + TAIL_TICKS),

    async arrange(api) {
      const snap = await startRun(api, MAP.single, { energy: 100000 });
      const g = pathGeom(snap.paths[0]);
      t = await placeCovering(api, "emitter", g, g.length * 0.18);
      t1 = towerById(await api.snapshot(), t.id);
    },

    async act(api) {
      // Selected first, so the inspector is already showing this tower's TIER I stats when
      // the clip opens — that is the "before" the upgrade is a change from.
      await api.call("selectTower", t.id);
      await api.settle(150);
      await api.advance(LEAD_TICKS);

      // The behavior under test.
      await api.call("upgradeTower", t.id);
      t2 = towerById(await api.snapshot(), t.id);

      // Held on the upgraded panel, so the new numbers can be read off the recording
      // against the ones that were there a moment ago.
      await api.settle(150);
      await api.advance(TAIL_TICKS);
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
