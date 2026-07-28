// Automated validation for the Controls sub-item `pause-p`.
//
// P pauses a live match (specs/controls.md).

import { newGame, press, actTail } from "../_helpers.mjs";

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

      // A key press and the state it leaves behind both resolve instantly, so without
      // this the clip is a still frame of a game that never visibly does anything —
      // three seconds of the result on screen is what makes it reviewable.
      await actTail(api, 180);
    },

    async assert(api, check) {
      check.expectEq("P pauses the match", screen, "paused");
    },
  };
}
