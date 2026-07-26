// Automated validation for the Economy sub-item `wave-clear-bonus`.
//
// Clearing a wave pays a wave-clear bonus that grows with the wave number
// (specs/economy.md — wave 1 pays 25). We run wave 1 to a clear in Deep Pockets
// (which pays no interest, so the bonus is isolated) from zero money and with no
// towers, so the whole wave leaks past and only the bonus lands.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let r;
  let money;

  return {
    id: "economy.wave-clear-bonus",

    // Deep Pockets pays no interest, and a zeroed balance with nothing built leaves
    // the wave bonus as the only thing that can pay out.
    async arrange(api) {
      await newGame(api, "deeppockets");
      await api.call("setLives", 1000000);
      await api.call("setMoney", 0);
      await api.call("startWave"); // begin wave 1
    },

    // 2400 ticks = the old 40s cap, polled every 12 ticks (the old 0.2s chunk).
    async act(api) {
      r = await api.until((s) => s.money >= 25, { max: 2400, poll: 12 });
      money = (await api.snapshot()).money;
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
