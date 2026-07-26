// Shift: delivering an optional package changes only the score — it never satisfies the
// quota nor fails the shift. An optional amber is carried into the amber zone on level 2;
// the optional tally rises but the shift keeps playing with the quota unmet.

import { setTile, startFresh, TICK } from "../_helpers.mjs";

export default function item() {
  // The snapshot the optional delivery produced.
  let snap;

  return {
    id: "shift.optional-no-completion",

    // Enter level 2 with an optional amber in hand.
    async arrange(api) {
      await startFresh(api, 2);
      await api.call("givePackage", {
        color: "amber",
        weightClass: "parcel",
        archetype: "optional",
      });
    },

    async act(api) {
      await setTile(api, 15, 3); // the amber (optional) zone
      await api.advance(TICK);
      snap = await api.snapshot();

      // Hold so the clip shows the shift carrying on afterwards — the point of the item
      // is that nothing ends. 36 ticks = the old 600ms clip hold.
      await api.advance(36);
    },

    async assert(api, check) {
      check.expectEq(
        "the optional delivery is tallied",
        snap.level.optionalsDelivered,
        1,
      );
      check.expectEq("the shift is still playing", snap.phase, "playing");
      check.expectEq(
        "the required quota is not met by an optional",
        snap.level.quotaMet,
        false,
      );
    },
  };
}
