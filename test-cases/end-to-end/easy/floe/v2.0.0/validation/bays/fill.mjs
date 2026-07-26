// Automated validation for the Bays item `fill`.
//
// Hopping up into an open far-shore bay completes the crossing, fills the bay, and
// scores. The critter is stood on a floe below bay 0 and a real up-hop fills it,
// which the snapshot reads back. See validation/_helpers.mjs.

import { startCrossing, WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // Bay 0's state before the hop (read instantly in `arrange`, since the hop is what
  // fills it), and the snapshot `act` took afterwards.
  let bayOpenBefore;
  let after;

  return {
    id: "bays.fill",

    // Pose the completed crossing minus its last hop: the score zeroed so the award
    // reads as a delta from nothing, a stationary floe below bay 0's column, and the
    // critter standing on it.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setScore", 0);
      await api.call("setLane", WATER_TOP, { cols: [3], speed: 0 }); // floe below bay 0
      await api.call("placeCritter", 3, WATER_TOP);
      bayOpenBefore = (await api.snapshot()).bays[0];
    },

    // The single real hop into the bay — the crossing completing, which is both what
    // is checked and all the clip needs to show.
    async act(api) {
      await api.call("press", "ArrowUp");
      await api.advance(24); // 0.2 s, long enough for the hop and the fill to resolve
      after = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("bay 0 starts open", bayOpenBefore, false);
      check.expectEq(
        "hopping up into an open bay fills it",
        after.bays[0],
        true,
      );
      check.expectGt("filling a bay awards score", after.score, 0);
    },
  };
}
