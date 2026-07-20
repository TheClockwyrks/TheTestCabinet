// Automated validation for the Hunter item `routes-around`.
//
// Facing a wall of vehicles across its path, the bear detours sideways to a gap
// and gets past it rather than driving straight into the traffic. A plow wall is
// laid across an ice row directly above the bear, with a gap to the right; the real
// pathfinder routes the bear sideways and then up through the gap, which the
// snapshots read back. See validation/_helpers.mjs.

import { startCrossing, clearIce, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The two sweeps: the sideways detour, then getting past the wall.
  let r1;
  let r2;

  return {
    id: "hunter.routes-around",

    // Pose the wall: the critter up top on a floe (so the hunt stays live and the bear
    // has something to path toward), the ice band otherwise cleared so only the wall
    // shapes the route, and the bear directly beneath a walled column.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLane", WATER_TOP, { cols: [20], speed: 0 }); // floe under the critter up top
      await api.call("placeCritter", 20, WATER_TOP);
      await clearIce(api);
      // A wall across row 17 covering columns ~4..15, leaving a gap on the right.
      await api.call("setLane", 17, { cols: [4, 7, 10, 13], speed: 0 });
      await api.call("setBear", 0, { col: 10, row: 18 }); // straight up is walled
    },

    // The detour and then the route past the wall — the pathfinding the item is about,
    // and exactly what the clip should show.
    async act(api) {
      // It detours sideways toward the gap.
      r1 = await api.until((s) => s.bears[0].present && s.bears[0].col > 10, {
        max: 240, // 2 s
        poll: 6, // 0.05 s
      });

      // And it routes past the wall through the gap.
      r2 = await api.until((s) => s.bears[0].present && s.bears[0].row < 17, {
        max: 600, // 5 s
        poll: 6, // 0.05 s
      });
    },

    async assert(api, check) {
      check.expectOk(
        "the bear detours sideways rather than into the wall",
        r1.hit,
      );
      check.expectOk("the bear routes around the wall and past it", r2.hit);
    },
  };
}
