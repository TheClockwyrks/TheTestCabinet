// Automated validation for the Economy sub-item `leak-costs-integrity`.
//
// Matter that reaches the collector costs integrity equal to the unit's leak value. The
// check poses a heavy isotope (leak value 3) just short of the collector, runs on until it
// leaks, and confirms integrity fell by exactly its leak value.

import { startRun, pathGeom, spawnAt, unitById, MAP } from "../_helpers.mjs";

const ISOTOPE_LEAK = 3; // MATTER.heavy.leak — specs/matter.md

export default function item() {
  let id;
  let int0;
  let r;

  return {
    id: "economy.leak-costs-integrity",

    async arrange(api) {
      const snap = await startRun(api, MAP.single, { integrity: 100 });
      const g = pathGeom(snap.paths[0]);
      id = await spawnAt(api, { type: "isotope", pathId: 0, s: g.length - 20 });
      int0 = (await api.snapshot()).integrity;
    },

    // The isotope covering the last stretch and leaking at the collector — the checked
    // behavior, so it is also the clip.
    async act(api) {
      // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk.
      r = await api.until((s) => unitById(s, id) == null, {
        max: 180,
        poll: 3,
      });
    },

    async assert(api, check) {
      check.expectOk("the unit leaked at the collector", r.hit);
      check.expectEq(
        "the leak cost integrity equal to the unit's leak value",
        int0 - r.snap.integrity,
        ISOTOPE_LEAK,
      );
    },
  };
}
