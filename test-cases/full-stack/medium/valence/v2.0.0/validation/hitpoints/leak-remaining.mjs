// Automated validation for the Hit Points sub-item `leak-remaining`.
//
// An atom that reaches the collector costs integrity equal to its REMAINING electrons,
// so a smaller (more-stripped) atom costs less than a full one — partial damage still
// helps. The check leaks a 4-electron and a 2-electron atom (no towers, so nothing
// alters them mid-flight) and confirms each costs its electron count, the smaller less.
//
// TWO runs: the 4-electron leak is arranged, the 2-electron leak posed inside `act` with
// `poseRun`. The old script re-posed a third run purely to film a leak; `act` already
// films two, so it is gone.

import {
  startRun,
  poseRun,
  pathGeom,
  spawnAt,
  unitById,
  MAP,
} from "../_helpers.mjs";

/** Pose an atom just short of the collector; `begin` opens the run. */
async function poseLeak(api, begin, electrons) {
  const snap = await begin(api, MAP.single, { integrity: 100000 });
  const g = pathGeom(snap.paths[0]);
  const id = await spawnAt(api, {
    type: "atom",
    electrons,
    pathId: 0,
    s: g.length - 20,
  });
  return { id, int0: (await api.snapshot()).integrity };
}

/** Run the posed atom into the collector and report what the leak cost. */
async function actLeakCost(api, { id, int0 }) {
  // 180 ticks = the old 3 s cap; poll 3 = the old 0.05 s chunk.
  const r = await api.until((s) => unitById(s, id) == null, {
    max: 180,
    poll: 3,
  });
  return { cost: int0 - r.snap.integrity, hit: r.hit };
}

export default function item() {
  let posedFull;
  let full;
  let small;

  return {
    id: "hitpoints.leak-remaining",

    async arrange(api) {
      posedFull = await poseLeak(api, startRun, 4);
    },

    // Both leaks, back to back: the full atom, then the more-stripped one.
    async act(api) {
      full = await actLeakCost(api, posedFull);

      const posedSmall = await poseLeak(api, poseRun, 2);
      small = await actLeakCost(api, posedSmall);
    },

    async assert(api, check) {
      check.expectOk("the full atom leaked", full.hit);
      check.expectEq("a 4-electron atom costs 4 integrity", full.cost, 4);
      check.expectEq("a 2-electron atom costs 2 integrity", small.cost, 2);
      check.expectLt(
        "a smaller (more-stripped) atom costs less integrity",
        small.cost,
        full.cost,
      );
    },
  };
}
