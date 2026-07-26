// Automated validation for the Maps sub-item `leak-at-collector`.
//
// Matter that travels a path's full length reaches the collector and leaks: it is
// removed from play and the leak costs integrity through the real containment check. A
// real unit is posed just short of the collector, and running the real sim carries it
// the rest of the way; the snapshot confirms it is gone and integrity fell.

import { startRun, pathGeom, spawnAt, unitById, MAP } from "../_helpers.mjs";

export default function item() {
  let id;
  let intBefore;
  let r;

  return {
    id: "maps.leak-at-collector",

    async arrange(api) {
      const snap = await startRun(api, MAP.single, { integrity: 100000 });
      const g = pathGeom(snap.paths[0]);
      id = await spawnAt(api, {
        type: "atom",
        electrons: 3,
        pathId: 0,
        s: g.length - 25,
      });
      intBefore = (await api.snapshot()).integrity;
    },

    // The unit covering the last stretch and leaking at the collector.
    async act(api) {
      // 240 ticks = the old 4 s cap; poll 6 = the old 0.1 s chunk.
      r = await api.until((s) => unitById(s, id) === null, {
        max: 240,
        poll: 6,
      });
    },

    async assert(api, check) {
      check.expectOk("the unit reaches the collector and is removed", r.hit);
      check.expectLt("the leak costs integrity", r.snap.integrity, intBefore);
    },
  };
}
