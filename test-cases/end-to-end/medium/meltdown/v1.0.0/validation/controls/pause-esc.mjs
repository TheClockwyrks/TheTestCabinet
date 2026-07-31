// Automated validation for the Controls sub-item `pause-esc`.
//
// Esc pauses a live match when nothing is armed or selected (specs/controls.md).

import { newGame, press, actTail } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "controls.pause-esc",

    // A live match with nothing armed or selected, so Esc has nothing to cancel and
    // falls through to pausing.
    async arrange(api) {
      await newGame(api, "containment", "medium");
    },

    async act(api) {
      await press(api, "Escape");
      screen = (await api.snapshot()).screen;

      // A key press and the state it leaves behind both resolve instantly, so without
      // this the clip is a still frame of a game that never visibly does anything —
      // three seconds of the result on screen is what makes it reviewable.
      await actTail(api, 180);
    },

    async assert(api, check) {
      check.expectEq("Esc pauses the match", screen, "paused");
    },
  };
}
