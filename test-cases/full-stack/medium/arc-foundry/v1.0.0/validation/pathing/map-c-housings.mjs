// Automated validation for pathing.map-c-housings: on The Transformer Yard the two housing
// rectangles are pre-blocked and never buildable, while the base waypoint route is open.
//
// The first housing spans tiles (12,6)..(19,12); a placement anchored inside it is refused
// (nothing lands), and the base ground route through the chain is finite and open.
//
// Opening the run on the map is the arrange; the REFUSED placement is the behavior under test
// and is the act.

import { startBuild, snap } from "../_helpers.mjs";

// A frame for the still, so the capture shows the untouched housings. 100 ms = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The opening board and the board after the refused drop.
  let s0;
  let s1;

  return {
    id: "pathing.map-c-housings",

    async arrange(api) {
      s0 = await startBuild(api, { map: "transformer" });
    },

    async act(api) {
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", 14, 8); // inside the first fixed housing
      s1 = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("housings");
    },

    async assert(api, check) {
      check.expectEq("the run is on The Transformer Yard", s0.map, "transformer");
      check.expectGt("the base waypoint route is open (a finite maze length)", s0.mazeLength, 0);
      check.expectEq("a placement on a fixed housing lands no candidate", s1.towers.length, s0.towers.length);
      check.expectEq("...and consumes no stamp", s1.stampsLeft, s0.stampsLeft);
    },
  };
}
