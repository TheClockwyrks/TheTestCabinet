// Automated validation for the Bonds sub-item `freed-faster`.
//
// An atom freed from a cluster moves faster than the cluster it came from — a lighter
// fragment picks up speed. The check reads a Polymer's base speed, chips it with a
// Cleaver until a free atom is shed, and confirms the freed atom's base speed exceeds
// the cluster's.

import {
  startRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let id;
  let clusterSpeed;
  let r;

  return {
    id: "bonds.freed-faster",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.18;
      await placeCovering(api, "cleaver", g, s0);
      // Spawn upstream so the cluster traverses the tower's full coverage window.
      id = await spawnAt(api, { type: "polymer", pathId: 0, s: s0 - 50 });
      clusterSpeed = unitById(await api.snapshot(), id).baseSpeed;
    },

    // Run the real sim until the cluster sheds its first free atom — exactly what the
    // clip needs to show.
    async act(api) {
      // 360 ticks = the old 6 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until(
        (s) => s.matter.some((u) => u.type === "atom" && u.id !== id),
        {
          max: 360,
          poll: 3,
        },
      );
    },

    async assert(api, check) {
      check.expectOk("the cluster shed a free atom", r.hit);
      const freed = r.snap.matter.find((u) => u.type === "atom" && u.id !== id);
      check.expectGt(
        "a freed atom moves faster than its parent cluster (baseSpeed)",
        freed.baseSpeed,
        clusterSpeed,
      );
    },
  };
}
