// Automated validation for the Controls sub-item `speed-toggle`.
//
// F toggles the game-speed control between 1x and 2x (specs/controls.md). We read the
// speed, press F, and read it toggle.

import { newGame, press } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "controls.speed-toggle",

    async arrange(api) {
      await newGame(api, "containment", "medium");
    },

    // Read the starting speed, press F, read the toggle. The settle gives the speed
    // indicator a frame to repaint before the still is captured.
    async act(api) {
      before = (await api.snapshot()).speed;
      await press(api, "KeyF");
      after = (await api.snapshot()).speed;
      await api.settle(80);
      await api.screenshot("speed");
    },

    async assert(api, check) {
      check.expectEq("the game starts at 1x", before, 1);
      check.expectEq("F toggles to 2x", after, 2);
    },
  };
}
