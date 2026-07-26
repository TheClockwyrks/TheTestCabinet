// Shift: delivering the full required quota before the clock ends completes the shift.
// Level 1 (no last train) needs three reds; two are pre-set and the real third delivery
// crosses the threshold and wins.

import { setTile, startFresh, TICK, deliveredOf } from "../_helpers.mjs";

export default function item() {
  // The snapshot the winning delivery produced.
  let snap;

  return {
    id: "shift.win-on-quota",

    // Pose level 1 one delivery short of its quota, with that delivery in hand.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("setDelivered", "red", 2); // one short of the quota of 3
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    async act(api) {
      await setTile(api, 4, 2); // the red zone — the real third delivery
      await api.advance(TICK);
      snap = await api.snapshot();

      await api.settle(150); // let the shift-complete screen paint before capturing it
      await api.screenshot("result");
    },

    async assert(api, check) {
      check.expectEq(
        "the third delivery meets the quota",
        deliveredOf(snap, "red"),
        3,
      );
      check.expectEq("meeting the quota wins the shift", snap.phase, "won");
      check.expectEq(
        "the shift-complete screen is shown",
        snap.screen,
        "level-complete",
      );
    },
  };
}
