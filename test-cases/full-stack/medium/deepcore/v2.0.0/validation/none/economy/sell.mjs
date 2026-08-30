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
    //
    // The beat BEFORE the sale is the point of the clip. A sale is instant — one control op that
    // moves the Credits and Cargo readouts between two consecutive frames — so a clip that opens
    // on the call has no "before" in it at all: the reviewer sees a bay that is already empty and
    // a balance that was always this number, which is not evidence of anything. Holding the posed
    // haul on screen first, and the paid balance after, is what makes the change legible.
    async act(api) {
      await api.advance(45); // 45 ticks = 0.75 s holding the loaded bay and the pre-sale balance
      await api.call("sell");
      snap = await api.snapshot();
      await api.advance(90); // 90 ticks = 1.5 s on the emptied bay and the paid balance
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
