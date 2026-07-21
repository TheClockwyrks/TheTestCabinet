// Scoring: each required (dispenser/unique) delivery adds its base points. A red dispenser
// package is delivered for real into the red zone; the required score component rises by 100.

import { setTile, startFresh, TICK, SCORE } from "../_helpers.mjs";

export default function item() {
  // The snapshot the delivery produced.
  let snap;

  return {
    id: "scoring.required",

    // Hand the worker a required (dispenser) red package.
    async arrange(api) {
      await startFresh(api, 1);
      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
    },

    async act(api) {
      // Entering the zone is the scoring trigger, so it happens here where it is filmed.
      await setTile(api, 4, 2); // the red zone
      await api.advance(TICK);
      snap = await api.snapshot();

      // Hold on the scored state for the clip. 30 ticks = the old 500ms clip hold.
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq(
        "the required-delivery score component is added",
        snap.level.scoreParts.required,
        SCORE.required,
      );
      check.expectGe(
        "the total score reflects the delivery",
        snap.level.score,
        SCORE.required,
      );
    },
  };
}
