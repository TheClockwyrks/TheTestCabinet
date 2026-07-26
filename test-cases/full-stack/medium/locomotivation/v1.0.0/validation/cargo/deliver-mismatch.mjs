// Cargo: a drop zone delivers nothing for a package of the wrong color. A blue package is
// carried onto the RED zone (4,2); nothing is delivered and the blue package stays carried.

import { setTile, startFresh, TICK, deliveredOf } from "../_helpers.mjs";

export default function item() {
  // The snapshot taken after the worker stood in the wrong-color zone.
  let snap;

  return {
    id: "cargo.deliver-mismatch",

    // Hand the worker a BLUE package — the mismatch the zone must refuse.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("givePackage", {
        color: "blue",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    async act(api) {
      // Entering the wrong zone is the behavior under test, so it happens here.
      await setTile(api, 4, 2); // the RED zone, wrong for a blue package
      await api.advance(TICK); // one tick, in which nothing should be delivered
      snap = await api.snapshot();

      // Hold so the clip shows the package staying put rather than a single frame.
      // 30 ticks = the old 500ms clip hold.
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq(
        "the wrong-color package stays carried",
        snap.worker.carried.length,
        1,
      );
      check.expectEq(
        "the red quota does not advance",
        deliveredOf(snap, "red"),
        0,
      );
    },
  };
}
