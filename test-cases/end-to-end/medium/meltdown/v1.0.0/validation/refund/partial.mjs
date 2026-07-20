// Automated validation for the Refund sub-item `partial`.
//
// Selling a tower that has fought a wave refunds 70% of everything spent on it
// (specs/towers.md). We place an Arc (cost 15) off in the corner, run wave 1 to a
// clear so the tower has fought, then sell it from zero money — 70% of 15 is 10.

import { newGame, build } from "../_helpers.mjs";

export default function item() {
  let id;
  let cleared;
  let money;

  return {
    id: "refund.partial",

    // The Arc goes far from any lane so it never fires — the refund is about having
    // lived through a wave, not about what the tower did during it.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 1000000);
      id = await build(api, "arc", 40, 30); // far from any lane, so it never fires
      await api.call("startWave");
    },

    // Run wave 1 through to its clear, then sell from a zeroed balance so the money
    // read back IS the refund. 2400 ticks = the old 40s cap, polled every 12 ticks
    // (the old 0.2s chunk) — the wave number only changes at the clear.
    async act(api) {
      cleared = await api.until((s) => s.wave >= 2, { max: 2400, poll: 12 });
      await api.call("setMoney", 0);
      await api.call("sellTower", id);
      money = (await api.snapshot()).money;
    },

    async assert(api, check) {
      check.expectOk("wave 1 was fought and cleared", cleared.hit);
      check.expectEq(
        "a fought tower refunds 70% of its 15 cost (10)",
        money,
        10,
      );
    },
  };
}
