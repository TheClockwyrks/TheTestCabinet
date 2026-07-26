// Cargo: carrying a package into its color-matched drop zone delivers it — the quota
// advances and the package leaves the carried set. The worker is posed carrying a red
// package (precondition) and stepped onto the red zone (4,2); the real delivery runs.

import { setTile, startFresh, TICK, deliveredOf } from "../_helpers.mjs";

export default function item() {
  // The red quota before the delivery, and the snapshot the delivery produced.
  let deliveredBefore;
  let snap;

  return {
    id: "cargo.deliver-match",

    // Hand the worker a red package and read the quota it starts from.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      deliveredBefore = deliveredOf(await api.snapshot(), "red");
    },

    async act(api) {
      // Entering the matching zone is the behavior under test, so it happens here where
      // it is filmed. `setTile` is a control op and legal mid-act.
      await setTile(api, 4, 2); // the red drop zone
      await api.advance(TICK); // one tick for the delivery to resolve
      snap = await api.snapshot();

      // Hold on the delivered state for the clip. 30 ticks = the old 500ms clip hold.
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq("red delivered starts at zero", deliveredBefore, 0);
      check.expectEq(
        "the matched delivery advances the red quota",
        deliveredOf(snap, "red"),
        1,
      );
      check.expectEq(
        "the delivered package left the carried set",
        snap.worker.carried.length,
        0,
      );
    },
  };
}
