// Controls: E (or Space) lifts an adjacent package. A ground package is placed in reach
// as a precondition; the real pickup runs when E's edge is sampled, growing the carried set.

import { actPressStep, setTile, startFresh } from "../_helpers.mjs";

export default function item() {
  // The carried count before the pickup, and the snapshot the pickup produced.
  let carriedBefore;
  let snap;

  return {
    id: "controls.pickup",

    // Pose the worker beside a ground package. Control ops plus a pure snapshot read.
    async arrange(api) {
      await startFresh(api, 1);
      await setTile(api, 10, 12);
      await api.call("spawnGroundPackage", {
        col: 10,
        row: 12,
        color: "red",
        weightClass: "parcel",
        archetype: "optional",
      });
      carriedBefore = (await api.snapshot()).worker.carried.length;
    },

    // The pickup itself: press E and advance one tick so its edge resolves through the
    // real cargo code.
    async act(api) {
      snap = await actPressStep(api, "KeyE");

      // The checked beat is a single tick, so hold on the result afterwards for the
      // clip. 42 ticks = the old 700ms clip hold.
      await api.advance(42);
    },

    async assert(api, check) {
      check.expectEq("nothing carried before the pickup", carriedBefore, 0);
      check.expectEq(
        "pressing E lifts the adjacent package",
        snap.worker.carried.length,
        1,
      );
      check.expectEq("the package left the ground", snap.ground.length, 0);
    },
  };
}
