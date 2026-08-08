// Automated validation for build.five-stamps-cap: a level grants five stamps; a sixth
// placement is refused, and the cap holds regardless of Charge.
//
// Only the opening of the run is arranged. Spending the allowance down and then being refused
// is the behavior under test, and placements are control ops, so the whole sequence is the act
// — the clip shows five rocks landing and the sixth and seventh going nowhere.

// WHY THIS IS A CLIP RATHER THAN A STILL. The item's claim is that the allowance RUNS OUT: five
// rocks land and the sixth does not. A frame taken at the end shows five candidates and an empty
// tile, which is equally a picture of a player who stopped at five — the refusal, and the
// allowance counting down to it, are events and cannot be in a single frame. The clip counts the
// allowance down a beat at a time and then shows two more drops going nowhere.

import { startBuild, SPOTS, snap, SECOND } from "../_helpers.mjs";

// A beat between drops, so the allowance is seen counting down rather than emptying at once.
const BEAT_TICKS = 0.8 * SECOND;
// A beat on each refused drop, so a reviewer sees the attempt land on nothing.
const REFUSED_TICKS = 1.2 * SECOND;

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
        await api.advance(BEAT_TICKS);
      }
      s1 = await snap(api);
      placed = s1.towers.length;

      // A sixth placement (a legal spot) is refused because the allowance is spent.
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", 14, 7);
      afterSixth = await snap(api);
      await api.advance(REFUSED_TICKS);

      // The cap is independent of Charge.
      await api.call("setCharge", 9999);
      await api.call("setNextRoll", "capacitor", 1);
      await api.call("placeRock", 14, 7);
      afterRich = await snap(api);

      await api.advance(REFUSED_TICKS);
    },

    async assert(api, check) {
      check.expectEq("a level grants five stamps", s0.stampsLeft, 5);
      check.expectEq("five placements exhaust the allowance", s1.stampsLeft, 0);
      check.expectEq("a sixth placement is refused", afterSixth.towers.length, placed);
      check.expectEq("the five-stamp cap holds regardless of Charge", afterRich.towers.length, placed);
    },
  };
}
