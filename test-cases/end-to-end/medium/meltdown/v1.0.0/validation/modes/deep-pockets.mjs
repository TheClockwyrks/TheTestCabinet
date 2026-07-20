// Automated validation for the Modes sub-item `deep-pockets`.
//
// Deep Pockets starts flush with 10,000 funds and pays no interest between waves
// (specs/modes.md). We read the opening balance, then clear wave 1 from 500 money
// with no towers — only the wave bonus (25) lands, with no interest (525 total).

import { newGame } from "../_helpers.mjs";

export default function item() {
  let s;
  let r;
  let money;

  return {
    id: "modes.deep-pockets",

    // The still this item declares is the vault after the payout, and running wave 1
    // out with nothing built takes ~18 s of real time — past the 8 s default record
    // budget, so the record pass would unwind before `screenshot` ever ran and the
    // declared output would never land. The item declares no video, so this lengthens
    // only the record pass, not any media it produces.
    clipMs: 36000,

    // The opening balance is read first, then the balance is re-posed to a round 500
    // so the payout at the clear can be read as an exact number.
    async arrange(api) {
      s = await newGame(api, "deeppockets");
      await api.call("setLives", 1000000);
      await api.call("setMoney", 500);
      await api.call("startWave");
    },

    // Run wave 1 to its clear with nothing built, so the whole wave leaks past and
    // the only money that lands is the payout. 2400 ticks = the old 40s cap, polled
    // every 12 ticks (the old 0.2s chunk).
    async act(api) {
      r = await api.until((t) => t.wave >= 2, { max: 2400, poll: 12 });
      money = (await api.snapshot()).money;
      await api.settle(80);
      await api.screenshot("deep");
    },

    async assert(api, check) {
      check.expectEq("Deep Pockets opens with 10,000 funds", s.money, 10000);
      check.expectOk("wave 1 cleared into the next build phase", r.hit);
      check.expectEq(
        "no interest is paid — only the wave bonus (525 total)",
        money,
        525,
      );
    },
  };
}
