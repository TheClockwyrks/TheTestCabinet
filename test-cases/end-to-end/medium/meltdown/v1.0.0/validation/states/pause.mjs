// Automated validation for the States sub-item `pause`.
//
// The pause state is reachable, offering resume, restart, and quit (specs/states.md).
// We start a match and pause it, then capture the pause menu.

import { newGame, press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.pause",

    async arrange(api) {
      await newGame(api, "containment", "medium");
    },

    async act(api) {
      await press(api, "KeyP");
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("pause");
    },

    async assert(api, check) {
      check.expectEq("the match pauses", screen, "paused");
    },
  };
}
