// Cargo: entering a zone delivers EVERY carried package of that color at once, while
// packages of other colors stay carried. The worker carries two reds and a blue and is
// stepped onto the red zone; both reds go, the blue remains.

import { setTile, startFresh, TICK, deliveredOf } from "../_helpers.mjs";

export default function item() {
  // The snapshot the delivery produced.
  let snap;

  return {
    id: "cargo.deliver-all-color",

    // Load the worker with two reds and a blue. Moving it onto the zone is the trigger,
    // so that stays in `act`.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      await api.call("givePackage", {
        color: "blue",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    async act(api) {
      // Entering the zone is what the item is about, so it is posed here — on camera —
      // rather than in arrange. `setTile` is a control op, so it is legal mid-act.
      await setTile(api, 4, 2); // the red zone
      await api.advance(TICK); // one tick for the delivery to resolve
      snap = await api.snapshot();

      // Hold on the result so the clip shows the delivered state, not one frame of it.
      // 30 ticks = the old 500ms clip hold.
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq(
        "both reds are delivered together",
        deliveredOf(snap, "red"),
        2,
      );
      check.expectEq(
        "the blue package stays carried",
        snap.worker.carried.length,
        1,
      );
      check.expectEq(
        "the remaining package is the blue one",
        snap.worker.carried[0].color,
        "blue",
      );
    },
  };
}
