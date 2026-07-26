// Automated validation for the Placement sub-item `range-gate`.
//
// A tower reaches only matter within its range. The check builds one emitter and poses
// two real units: one at the tower's own point (in range) and one far along the path,
// spatially distant (out of range). Running the real sim damages only the near one.

import {
  startRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

export default function item() {
  let near;
  let far;
  let nearHp0;
  let farHp0;
  let now;

  return {
    id: "placement.range-gate",

    async arrange(api) {
      const snap = await startRun(api, MAP.single);
      const g = pathGeom(snap.paths[0]);
      const s0 = g.length * 0.18;
      await placeCovering(api, "emitter", g, s0);
      near = await spawnAt(api, {
        type: "atom",
        electrons: 5,
        pathId: 0,
        s: s0,
      });
      far = await spawnAt(api, {
        type: "atom",
        electrons: 5,
        pathId: 0,
        s: g.length * 0.5,
      });

      nearHp0 = unitById(await api.snapshot(), near).hp;
      farHp0 = unitById(await api.snapshot(), far).hp;
    },

    // The tower working on the near unit and plainly ignoring the far one.
    async act(api) {
      // 72 ticks = the old 1.2 s.
      await api.advance(72);
      now = await api.snapshot();
    },

    async assert(api, check) {
      check.expectLt(
        "the in-range unit is fired on (hp drops)",
        unitById(now, near).hp,
        nearHp0,
      );
      check.expectEq(
        "the out-of-range unit is untouched (hp unchanged)",
        unitById(now, far).hp,
        farHp0,
      );
    },
  };
}
