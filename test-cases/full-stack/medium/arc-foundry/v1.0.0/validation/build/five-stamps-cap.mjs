// Automated validation for build.five-stamps-cap: a level grants five stamps; a sixth
// placement is refused, and the cap holds regardless of Charge.
//
// Only the opening of the run is arranged. Spending the allowance down and then being refused
// is the behavior under test, and placements are control ops, so the whole sequence is the act
// — the clip shows five rocks landing and the sixth and seventh going nowhere.

import { startBuild, SPOTS, snap } from "../_helpers.mjs";

// A frame for the still after the last refused placement. 100 ms x 60 Hz = 6 ticks.
const SETTLE_TICKS = 6;

export default function item() {
  // The opening allowance and the board after each stage, read by `assert`.
  let s0;
  let s1;
  let placed;
  let afterSixth;
  let afterRich;

  return {
    id: "build.five-stamps-cap",

    async arrange(api) {
      s0 = await startBuild(api);
    },

    async act(api) {
      for (const spot of SPOTS) {
        await api.call("setNextRoll", "capacitor", 1);
        await api.call("placeRock", spot.col, spot.row);
      }
      s1 = await snap(api);
      placed = s1.towers.length;

      // A sixth placement (a legal spot) is refused because the allowance is spent.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", 14, 7);
      afterSixth = await snap(api);

      // The cap is independent of Charge.
      await api.call("setCharge", 9999);
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", 14, 7);
      afterRich = await snap(api);

      await api.advance(SETTLE_TICKS);
      await api.screenshot("cap");
    },

    async assert(api, check) {
      check.expectEq("a level grants five stamps", s0.stampsLeft, 5);
      check.expectEq("five placements exhaust the allowance", s1.stampsLeft, 0);
      check.expectEq("a sixth placement is refused", afterSixth.towers.length, placed);
      check.expectEq("the five-stamp cap holds regardless of Charge", afterRich.towers.length, placed);
    },
  };
}
