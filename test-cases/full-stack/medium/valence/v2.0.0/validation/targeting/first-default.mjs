// Automated validation for the Targeting sub-item `first-default`.
//
// By default a damage tower fires at the FIRST target — the valid in-range unit furthest
// along its path. The check poses three real atoms at increasing progress in a Beam's
// range and, after one real tick, reads which one the tower acquired: the furthest along.

import {
  startScenario,
  pathGeom,
  placeCovering,
  spawnAt,
  towerById,
  TICK,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let t;
  let front;
  let targetId;

  return {
    id: "targeting.first-default",

    async arrange(api) {
      const snap = await startScenario(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.2;
      t = await placeCovering(api, "beam", g, s0);
      await spawnAt(api, {
        type: "atom",
        electrons: 4,
        pathId: 0,
        s: s0 - 120,
      });
      await spawnAt(api, { type: "atom", electrons: 4, pathId: 0, s: s0 });
      front = await spawnAt(api, {
        type: "atom",
        electrons: 4,
        pathId: 0,
        s: s0 + 120,
      });
    },

    // One tick is all the acquisition needs, and the clip then shows the Beam holding on
    // the leading atom while the two behind it go unattended.
    async act(api) {
      await api.advance(TICK);
      targetId = towerById(await api.snapshot(), t.id).targetId;
    },

    async assert(api, check) {
      check.expectEq(
        "the default target is the unit furthest along the path",
        targetId,
        front,
      );
    },
  };
}
