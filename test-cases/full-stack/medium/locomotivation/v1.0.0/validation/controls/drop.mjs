// Controls: Q sets down the most-recently carried package. A package is placed in the
// carried set as a precondition; the real drop runs when Q's edge is sampled.

import { actPressStep, setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The carried count before the drop, and the snapshot the drop produced.
  let carriedBefore;
  let snap;

  return {
    id: "controls.drop",

    // Pose the worker holding one package. Control ops plus a pure snapshot read, so
    // none of it consumes time and all of it belongs here.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 10, 12);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      carriedBefore = (await api.snapshot()).worker.carried.length;
    },

    // The drop itself: press Q and advance one tick so its edge resolves through the
    // real cargo code.
    async act(api) {
      snap = await actPressStep(api, "KeyQ");

      // The checked beat is a single tick — far too short to see — so hold on the
      // result afterwards. 42 ticks = the old 700ms clip hold.
      await api.advance(42);
    },

    async assert(api, check) {
      check.expectEq("carrying one before the drop", carriedBefore, 1);
      check.expectEq(
        "pressing Q sets the package down",
        snap.worker.carried.length,
        0,
      );
      check.expectEq("the package landed on the ground", snap.ground.length, 1);
    },
  };
}
