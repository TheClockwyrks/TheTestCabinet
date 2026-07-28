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
    //
    // Skipped, because the declared output is a STILL of the vault after the payout
    // and this item records no video — the wave was being run in real time for nobody.
    // It also had to carry a `clipMs` sized to the sweep's CAP rather than the wave's
    // typical length, for a subtle reason worth keeping in mind: how long wave 1 takes
    // to clear is the build's own business, and an earlier budget sized to the 18 s the
    // wave "usually" took unwound at 36 s against a build whose wave cleared at 37.4 s.
    // A missing declared output fails the item wholesale (`ran = hardStopped ||
    // missing.length === 0` in the driver) with a message about the debug API — a
    // verdict that would otherwise have passed on every assertion. Skipping removes the
    // whole hazard: with no wall clock to run out, no conformant build can be failed
    // for taking longer than another one.
    async act(api) {
      r = await api.skipUntil((t) => t.wave >= 2, { max: 2400, poll: 12 });
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
