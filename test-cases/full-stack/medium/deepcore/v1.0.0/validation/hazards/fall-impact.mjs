// Automated validation for hazards.fall-impact.
//
// A long free-fall lands hard enough to damage the hull, scaled to the excess landing speed. We
// drop the miner down a tall open shaft onto a floor and read the hull lost on the slam.

import {
  teleportInto,
  newRun,
  openColumn,
  solid,
  SPAWN_COL,
  TOPSOIL_ROW,
} from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = TOPSOIL_ROW;
  let hull0;
  let r;

  return {
    id: "hazards.fall-impact",

    // A high hull at the top of a long open plunge, so the slam is survivable and reads in full.
    async arrange(api) {
      await newRun(api);
      await teleportInto(api, col, row);
      await openColumn(api, col, row + 1, row + 12); // a long open plunge
      await solid(api, col, row + 13);
      await api.call("grantGear", { hull: 5 }); // survive the slam; hull 450, refilled
      hull0 = (await api.snapshot()).miner.hull;
    },

    // The plunge and the landing are the behavior, and the clip shows exactly that.
    async act(api) {
      // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk, fine enough to catch the
      // landing frame rather than a moment after the impact damage has been applied.
      r = await api.until((s) => s.miner.grounded && s.miner.row > row + 5, {
        max: 180,
        poll: 3,
      });
    },

    async assert(api, check) {
      check.expectOk("the miner landed after the plunge", r.hit);
      check.expectGt(
        "a long plunge deals impact hull damage",
        hull0 - r.snap.miner.hull,
        10,
      );
    },
  };
}
