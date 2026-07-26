// Automated validation for economy.sell.
//
// Selling the cargo at the Ore Market converts the whole haul to Credits at each ore's listed value
// and empties the bay. We pose a known haul, sell through the real market path, and read back.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let before;
  let snap;

  return {
    id: "economy.sell",

    // A known haul in the bay, and the Credits balance it will be added to.
    async arrange(api) {
      await newRun(api);
      before = (await api.snapshot()).credits;
      await api.call("addCargo", "cuprite", 3); // 3 x 65 Cr = 195
    },

    // The sale IS the behavior under test, so the clip shows it go through.
    async act(api) {
      await api.call("sell");
      snap = await api.snapshot();
      await api.advance(30); // 30 ticks = 0.5 s, the old 500 ms clip tail
    },

    async assert(api, check) {
      check.expectEq(
        "selling pays the haul's value in Credits",
        snap.credits - before,
        195,
      );
      check.expectEq(
        "the bay is emptied after selling",
        snap.cargo.slotsUsed,
        0,
      );
    },
  };
}
