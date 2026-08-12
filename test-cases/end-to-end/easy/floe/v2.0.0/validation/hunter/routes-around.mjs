// Automated validation for the Hunter item `routes-around`.
//
// Facing a wall of vehicles across its path, the bear detours sideways to a gap
// and gets past it rather than driving straight into the traffic. A plow wall is
// laid across an ice row directly above the bear, with a gap to the right; the real
// pathfinder routes the bear sideways and then up through the gap, which the
// snapshots read back. See validation/_helpers.mjs.

// IT MUST BE THE SAME BEAR THROUGHOUT. Both sweeps below ask only that a bear is present
// and has got somewhere, and a bear that dies against the wall is replaced a second or two
// later by a fresh one emerging from the near shore — at a different column, with a clear
// run up. That replacement satisfies "it moved right of where it started" and "it is above
// the wall row" without anything ever having routed around anything, so the item can be
// won by exactly the failure it exists to catch. One of the builds this case was audited
// against does precisely that: its bear turns straight up into the parked wall, is removed
// at 0.18 s, and the sweeps then track its successor. So the sweeps also watch for the
// posed bear going missing, and the item says so rather than crediting the stand-in.
//
// Driving into a parked vehicle and dying is itself two departures from the spec — the
// bear "will not turn toward a tile a hazard occupies" (specs/hunter.md), and only a
// hazard that SLIDES INTO it resets it, where a hop INTO a vehicle is refused rather than
// fatal (specs/hazards.md). Naming the disappearance is enough here; which of the two
// caused it belongs to the items about those rules.

import { startCrossing, clearIce, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The two sweeps: the sideways detour, then getting past the wall — and whether the
  // bear that started them was still there to finish them.
  let vanished;
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
      vanished = false;
      // Each sample notes a bear that has gone off the board before deciding whether the
      // route has been made, so a build whose bear dies against the wall is not credited
      // with the journey its replacement makes.
      const stillThere = (s) => {
        if (!s.bears[0].present) {
          vanished = true;
          return false;
        }
        return true;
      };

      // It detours sideways toward the gap.
      r1 = await api.until((s) => stillThere(s) && s.bears[0].col > 10, {
        max: 240, // 2 s
        poll: 6, // 0.05 s
      });

      // And it routes past the wall through the gap.
      r2 = await api.until((s) => stillThere(s) && s.bears[0].row < 17, {
        max: 600, // 5 s
        poll: 6, // 0.05 s
      });
    },

    async assert(api, check) {
      check.expectOk(
        "the same bear is on the board throughout, not killed by the wall and replaced",
        !vanished,
      );
      check.expectOk(
        "the bear detours sideways rather than into the wall",
        r1.hit,
      );
      check.expectOk("the bear routes around the wall and past it", r2.hit);
    },
  };
}
