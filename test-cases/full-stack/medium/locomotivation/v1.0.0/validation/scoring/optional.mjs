// Scoring: an optional delivery is worth more than a required one — the greed reward. On
// level 2 an optional amber and a required red are each delivered for real; the optional
// component (per delivery) exceeds the required one.

import { setTile, startFresh, TICK, SCORE } from "../_helpers.mjs";

export default function item() {
  // A snapshot after each of the two deliveries.
  let afterOptional;
  let afterRequired;

  return {
    id: "scoring.optional",

    // Enter level 2 with the optional amber already in hand. The second package is given
    // mid-`act`, after the first delivery has been read, so the two deliveries score
    // independently.
    async arrange(api) {
      await startFresh(api, 2);
      await api.call("givePackage", {
        color: "amber",
        weightClass: "parcel",
        archetype: "optional",
      });
    },

    // Both deliveries back to back, each on camera. `setTile` and `givePackage` are
    // control ops, so posing the second run mid-act is legal and does not touch the clock.
    async act(api) {
      await setTile(api, 15, 3); // amber (optional) zone
      await api.advance(TICK);
      afterOptional = await api.snapshot();

      await api.call("givePackage", {
        color: "red",
        weightClass: "parcel",
        archetype: "dispenser",
      });
      await setTile(api, 30, 1); // red zone
      await api.advance(TICK);
      afterRequired = await api.snapshot();

      // Hold on the scored state for the clip. 30 ticks = the old 500ms clip hold.
      await api.advance(30);
    },

    async assert(api, check) {
      check.expectEq(
        "the optional delivery scores its value",
        afterOptional.level.scoreParts.optional,
        SCORE.optional,
      );
      check.expectEq(
        "the required delivery scores its value",
        afterRequired.level.scoreParts.required,
        SCORE.required,
      );
      check.expectGt(
        "an optional is worth more than a required delivery",
        SCORE.optional,
        SCORE.required,
      );
    },
  };
}
