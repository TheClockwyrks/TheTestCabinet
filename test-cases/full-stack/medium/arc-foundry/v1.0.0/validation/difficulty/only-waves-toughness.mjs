// Automated validation for difficulty.only-waves-toughness: Easy / Medium / Hard change only
// the wave count and enemy HP scaling; starting Charge, Grid Integrity, and the five-stamp
// allowance are identical on all three.
//
// The whole comparison re-starts the run five times, which only `arrange` may do — and every
// value read (opening economy, spawn-time stats) is available the instant a run opens, so no
// game time is needed for the verdict. The act then holds on the last board (Hard, with a Mote
// released) long enough for the still.

import { startBuild, spawnControlled, DIFFICULTY, START_CHARGE, START_INTEGRITY, SECOND } from "../_helpers.mjs";

// The released Mote walking makes the capture a live board rather than a frozen one.
const CLIP_TICKS = 1 * SECOND;

export default function item() {
  // The opening snapshot per difficulty, and the two Motes compared for HP/speed.
  const opening = {};
  let me;
  let mh;

  return {
    id: "difficulty.only-waves-toughness",

    async arrange(api) {
      for (const d of ["easy", "medium", "hard"]) {
        opening[d] = await startBuild(api, { difficulty: d });
      }

      // HP scaling differs by difficulty; speed does not.
      await startBuild(api, { difficulty: "easy" });
      [me] = await spawnControlled(api, "mote", { wave: 1 });
      await startBuild(api, { difficulty: "hard" });
      [mh] = await spawnControlled(api, "mote", { wave: 1 });
    },

    async act(api) {
      await api.advance(CLIP_TICKS);
      await api.screenshot("diff");
    },

    async assert(api, check) {
      for (const d of ["easy", "medium", "hard"]) {
        const s = opening[d];
        check.expectEq(`${d} total waves`, s.totalWaves, DIFFICULTY[d].waves);
        check.expectEq(`${d} starting Charge is identical`, s.charge, START_CHARGE);
        check.expectEq(`${d} starting Grid Integrity is identical`, s.integrity, START_INTEGRITY);
        check.expectEq(`${d} five-stamp allowance is identical`, s.stampsLeft, 5);
      }

      check.expectNe("enemy HP scaling differs by difficulty", me.maxHp, mh.maxHp);
      check.expectEq("...but enemy speed is identical", me.baseSpeed, mh.baseSpeed);
    },
  };
}
