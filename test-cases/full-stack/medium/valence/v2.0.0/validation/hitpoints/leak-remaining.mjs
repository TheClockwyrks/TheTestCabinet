// Automated validation for the Hit Points sub-item `leak-remaining`.
//
// An atom that reaches the collector costs integrity equal to its REMAINING electrons,
// so a smaller (more-stripped) atom costs less than a full one — partial damage still
// helps. The check leaks a 4-electron and a 2-electron atom (no towers, so nothing
// alters them mid-flight) and confirms each costs its electron count, the smaller less.
//
// TWO runs: the 4-electron leak is arranged, the 2-electron leak posed inside `act` with
// `poseScenario`. The old script re-posed a third run purely to film a leak; `act` already
// films two, so it is gone.

import {
  startScenario,
  poseScenario,
  pathGeom,
  spawnAt,
  unitById,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

// How far short of the collector each atom is posed. What this item shows is a NUMBER
// changing — the integrity read in the status bar — and a number is only legible if the
// reviewer has seen what it was before it moved. Posed 20px out, a 4-electron atom (72 px/s,
// specs/matter.md) crossed that in under a third of a second, so both leaks happened almost
// the instant their scene appeared and the two of them ran back to back in about a second.
// From 170px out the atom is on screen and travelling for over two seconds before it
// arrives, which is the "before" the review asked for.
const APPROACH_PX = 170;
// Cap for the run-in sweep: comfortably more than the slowest atom (44 px/s) needs to cover
// APPROACH_PX, so a conformant build never times out.
const MAX_LEAK_TICKS = 360;

/** Pose an atom a readable distance short of the collector; `begin` opens the run. */
async function poseLeak(api, begin, electrons) {
  const snap = await begin(api, MAP.single, { integrity: 100000 });
  const g = pathGeom(snap.paths[0]);
  const id = await spawnAt(api, {
    type: "atom",
    electrons,
    pathId: 0,
    s: g.length - APPROACH_PX,
  });
  return { id, int0: (await api.snapshot()).integrity };
}

/**
 * Run the posed atom into the collector and report what the leak cost, framed so the
 * transition is watchable: the standing integrity first, the run-in and the leak, then the
 * integrity it settled at.
 */
async function actLeakCost(api, { id, int0 }) {
  await api.advance(LEAD_TICKS);
  // poll 3 = the old 0.05 s chunk.
  const r = await api.until((s) => unitById(s, id) == null, {
    max: MAX_LEAK_TICKS,
    poll: 3,
  });
  await api.advance(TAIL_TICKS);
  return { cost: int0 - r.snap.integrity, hit: r.hit };
}

// Two leaks, each framed. The budget has to cover both or the second one — the whole basis
// of the "a smaller atom costs less" comparison — never reaches the clip.
const SCENE_TICKS = LEAD_TICKS + MAX_LEAK_TICKS + TAIL_TICKS;

export default function item() {
  let posedFull;
  let full;
  let small;

  return {
    id: "hitpoints.leak-remaining",

    clipMs: clipBudget(2 * SCENE_TICKS),

    async arrange(api) {
      posedFull = await poseLeak(api, startScenario, 4);
    },

    // Both leaks, back to back: the full atom, then the more-stripped one.
    async act(api) {
      full = await actLeakCost(api, posedFull);

      const posedSmall = await poseLeak(api, poseScenario, 2);
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
