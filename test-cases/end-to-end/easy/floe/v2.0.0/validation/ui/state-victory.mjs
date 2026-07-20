// Automated validation for the UI item `state-victory`: the victory screen is
// reachable, and the debug API captures it. Level 8 is cleared through the real
// flow (fill the fifth bay) and the victory screen read back and captured. The
// layout is judged by eye.

import { WATER_TOP } from "../_helpers.mjs";

export default function item() {
  // The screen after the clearing hop.
  let screen;

  return {
    id: "ui.state-victory",

    // Pose the final level one bay short of done: level 8, four bays filled, and the
    // critter on a floe below the fifth.
    async arrange(api) {
      await api.reset();
      await api.call("setLevel", 8);
      await api.call("setBays", [true, true, true, true, false]);
      await api.call("setLane", WATER_TOP, { cols: [35], speed: 0 });
      await api.call("placeCritter", 35, WATER_TOP);
    },

    // The hop that wins the game, then a moment for the victory screen to draw before
    // capturing it.
    async act(api) {
      await api.call("press", "ArrowUp");
      await api.advance(24); // 0.2 s, long enough for the fill and the win to resolve
      screen = (await api.snapshot()).screen;
      await api.advance(18); // 0.15 s, so the victory screen has drawn
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectEq(
        "clearing level 8 reaches the victory screen",
        screen,
        "victory",
      );
    },
  };
}
