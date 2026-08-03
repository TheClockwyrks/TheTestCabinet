// Automated validation for economy.value-rises-depth.
//
// A deep ore sells for many times a shallow one. We sell one unit of the shallowest ore and one of
// the deepest, reading the Credits each fetches through the real market path.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let shallow;
  let deep;

  return {
    id: "economy.value-rises-depth",

    async arrange(api) {
      await newRun(api);
    },

    // Both sales run here — they are the behavior under test, and the clip shows the two very
    // different payouts land back to back.
    // Each sale is instant, so without a beat on either side of it the two payouts land on
    // consecutive frames and the clip shows one final balance rather than a small payout followed
    // by a large one — which IS the comparison the item asserts. Each ore is held in the bay for a
    // beat before it is sold and its payout held after, so the reviewer reads two distinct steps.
    async act(api) {
      const c0 = (await api.snapshot()).credits;
      await api.call("addCargo", "ferron", 1); // shallowest ore
      await api.advance(45); // 45 ticks = 0.75 s with the shallow ore in the bay
      await api.call("sell");
      shallow = (await api.snapshot()).credits - c0;
      await api.advance(60); // 60 ticks = 1 s on the small payout

      const c1 = (await api.snapshot()).credits;
      await api.call("addCargo", "adamite", 1); // deepest ore
      await api.advance(45);
      await api.call("sell");
      deep = (await api.snapshot()).credits - c1;
      await api.advance(90); // 90 ticks = 1.5 s on the far larger payout
    },

    async assert(api, check) {
      check.expectGt("a shallow ore is worth a little", shallow, 0);
      check.expectGt("a deep ore is worth far more", deep, shallow * 10);
    },
  };
}
