// Automated validation for difficulty.only-waves-toughness: Easy / Medium / Hard change only
// the wave count and enemy HP scaling; starting Charge, Grid Integrity, and the five-stamp
// allowance are identical on all three.
//
// ONE STILL PER DIFFICULTY. The evidence used to be a single frame, taken on whichever run the
// sweep happened to end on — Hard, with a Mote walking. The claim is a COMPARISON across the three
// settings: four figures that must be identical and one wave count that must differ. A picture of
// one of them cannot make it, because there is nothing in the frame to compare against; a reviewer
// saw a board reading `WAVE 1 / 60` and had no way to know what the other two read.
//
// So each difficulty's opening build phase is captured as it is opened, and the three stills carry
// the same three readings the assertions do: the same Charge, the same Grid Integrity, the same
// five stamps, against a wave count of 40 / 50 / 60.
//
// The runs are re-opened in `act`, which `reset` is legal in — the runtime hands the build's clock
// straight back afterwards, so nothing films a frozen game. The HP comparison stays in `arrange`:
// it needs two more runs and reads values fixed at spawn, so it costs no game time and belongs
// nowhere near the camera.

import { startBuild, spawnControlled, DIFFICULTY, START_CHARGE, START_INTEGRITY } from "../_helpers.mjs";

// The three settings, and the output each one's still lands in.
const RUNS = [
  { difficulty: "easy", output: "diff-easy" },
  { difficulty: "medium", output: "diff-medium" },
  { difficulty: "hard", output: "diff-hard" },
];
// A real pause so the build's own frame loop paints the opening board before each still. The HUD
// is PAINTED, and instant stepping paints nothing.
const PAINT_MS = 250;

export default function item() {
  // The opening snapshot per difficulty, and the two Motes compared for HP/speed.
  const opening = {};
  let me;
  let mh;

  return {
    id: "difficulty.only-waves-toughness",

    async arrange(api) {
      // HP scaling differs by difficulty; speed does not. Read at spawn, so no game time is used.
      await startBuild(api, { difficulty: "easy" });
      [me] = await spawnControlled(api, "mote", { wave: 1 });
      await startBuild(api, { difficulty: "hard" });
      [mh] = await spawnControlled(api, "mote", { wave: 1 });
    },

    async act(api) {
      for (const { difficulty, output } of RUNS) {
        opening[difficulty] = await startBuild(api, { difficulty });
        await api.settle(PAINT_MS);
        await api.screenshot(output);
      }
    },

    async assert(api, check) {
      for (const { difficulty: d } of RUNS) {
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
