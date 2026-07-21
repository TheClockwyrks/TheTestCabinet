// Automated validation for the Placement sub-item `auto-fire`.
//
// A built damage tower fires at valid in-range matter with NO manual trigger. The check
// builds an emitter beside the lane and poses a unit in range, then simply runs the
// real sim: the tower acquires the unit and damages it on its own.

import { coverAndSpawn, unitById, towerById } from "../_helpers.mjs";

export default function item() {
  let unitId;
  let towerId;
  let hp0;
  let r;

  return {
    id: "placement.auto-fire",

    async arrange(api) {
      ({ unitId, towerId } = await coverAndSpawn(api, {
        kind: "emitter",
        type: "atom",
        electrons: 5,
      }));
      hp0 = unitById(await api.snapshot(), unitId).hp;
    },

    // Nothing is commanded here — the point is that time alone is enough for the tower to
    // acquire and fire, which is exactly what the clip shows.
    async act(api) {
      // 180 ticks = the old 3 s cap; poll 6 = the old 0.1 s chunk.
      r = await api.until(
        (s) => {
          const u = unitById(s, unitId);
          return u != null && u.hp < hp0;
        },
        { max: 180, poll: 6 },
      );
    },

    async assert(api, check) {
      check.expectOk("the tower fires unprompted and damages the unit", r.hit);
      check.expectOk(
        "the tower acquired the in-range unit as its target",
        towerById(r.snap, towerId).targetId != null,
      );
    },
  };
}
