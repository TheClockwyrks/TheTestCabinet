// Automated validation for the Progression item `victory`.
//
// Clearing the eighth level wins the game (the victory screen appears). The level
// is set to 8 with four bays filled; a real hop fills the fifth, and the real
// flow reaches victory, which the snapshot reads back and a screenshot captures.
// See validation/_helpers.mjs.

import { WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The screen after the clearing hop.
  let screen;

  return {
    id: "progression.victory",

    // Pose the final level one bay short of done: level 8, four bays filled, and the
    // critter on a floe below the fifth.
    async arrange(api) {
      await api.reset();
      await api.call("setLevel", 8);
      await api.call("setBays", [true, true, true, true, false]);
      await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
      await api.call("placeCritter", 35, WATER_TOP);
    },

    // The hop that wins the game — what is checked, and what the capture shows.
    async act(api) {
      await api.call("press", "ArrowUp"); // fill the fifth bay at level 8 -> victory
      await api.advance(24); // 0.2 s, long enough for the fill and the win to resolve
      screen = (await api.snapshot()).screen;
      await api.advance(18); // 0.15 s, so the victory screen has drawn
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectEq("clearing level 8 wins the game", screen, "victory");
    },
  };
}
