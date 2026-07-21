// Automated validation for the Controls sub-item `pause-p`.
//
// P pauses a live match (specs/controls.md).

import { newGame, press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "controls.pause-p",

    async arrange(api) {
      await newGame(api, "containment", "medium");
    },

    async act(api) {
      await press(api, "KeyP");
      screen = (await api.snapshot()).screen;
    },

    async assert(api, check) {
      check.expectEq("P pauses the match", screen, "paused");
    },
  };
}
