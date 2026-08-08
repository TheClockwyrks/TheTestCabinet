// Automated validation for the Economy sub-item `wave-clear-bonus`.
//
// Clearing a wave pays a wave-clear bonus that grows with the wave number
// (specs/economy.md — wave 1 pays 25). We run wave 1 to a clear in Deep Pockets
// (which pays no interest, so the bonus is isolated) from zero money and with no
// towers, so the whole wave leaks past and only the bonus lands.

import { newGame, actTail, nearlyOut } from "../_helpers.mjs";

export default function item() {
  let r;
  let money;

  return {
    id: "economy.wave-clear-bonus",

    // `arrange` skips the wave to its last unit's approach, so only the clear and the
    // payout are filmed. The ceiling stops a build whose last unit wanders from padding
    // that out.
    clipMs: 5000,

    // Deep Pockets pays no interest, and a zeroed balance with nothing built leaves
    // the wave bonus as the only thing that can pay out.
    //
    // Wave 1 then walks itself out across an undefended floor, which takes most of a
    // minute and is not what this item is about — the claim is what lands at the END.
    // So the wave is run through unfilmed as far as its last unit's final approach,
    // and `act` is the clear itself: the last Mote leaving, and the balance stepping
    // from 0 to 25. 2400 ticks = the old 40s cap, kept as the skip's ceiling since the
    // skip decides nothing.
    async arrange(api) {
      await newGame(api, "deeppockets");
      await api.call("setLives", 1000000);
      await api.call("setMoney", 0);
      await api.call("startWave"); // begin wave 1
      await api.skipUntil(
        (s) =>
          s.money >= 25 || (s.waveRemaining <= 1 && s.surge.every(nearlyOut)),
        { max: 2400, poll: 12 },
      );
    },

    // 600 ticks = 10s: the skip stopped on the last unit's approach, so only that
    // remains. The sweep ends on the sample the balance moves, and the tail holds on
    // the paid-out 25 rather than cutting the frame it appears.
    async act(api) {
      r = await api.until((s) => s.money >= 25, { max: 600, poll: 6 });
      money = (await api.snapshot()).money;
      await actTail(api, 120); // 2 s on the bonus and the cleared floor
    },

    async assert(api, check) {
      check.expectOk("wave 1 cleared and paid out", r.hit);
      check.expectEq(
        "clearing wave 1 pays exactly the wave bonus (25), no interest",
        money,
        25,
      );
    },
  };
}
