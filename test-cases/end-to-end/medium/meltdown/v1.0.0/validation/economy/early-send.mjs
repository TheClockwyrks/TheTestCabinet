// Automated validation for the Economy sub-item `early-send`.
//
// Sending a wave early during a timed build phase pays a bonus equal to the seconds
// left on the countdown (specs/economy.md). We enter a timed between-wave build phase,
// set a known 7-second countdown and 100 money, and send early — the money rises by
// exactly 7.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let money;

  return {
    id: "economy.early-send",

    // A timed build phase with a known countdown and balance, so the bonus can be
    // read as an exact difference.
    //
    // `setBuildTimer` takes SECONDS, not ticks: it poses the countdown the player
    // reads off the HUD rather than advancing time, so its operand stays 7.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setWave", 2); // a timed between-wave build phase
      await api.call("setMoney", 100);
      await api.call("setBuildTimer", 7);
    },

    async act(api) {
      await api.call("startWave"); // send early
      money = (await api.snapshot()).money;
      await api.settle(80);
      await api.screenshot("early");
    },

    async assert(api, check) {
      check.expectEq("sending with 7s left pays a bonus of 7", money, 107);
    },
  };
}
