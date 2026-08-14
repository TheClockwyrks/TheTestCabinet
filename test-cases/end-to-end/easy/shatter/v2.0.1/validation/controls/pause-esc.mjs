// Automated validation for the Controls item `pause-esc`: Esc pauses the game. A real game
// is in play; pressing Esc must move it to the paused state.
//
// Starting the game is the precondition (`arrange`); the press is the behavior (`act`), so
// the clip opens on a live game and shows it stop, which is the point of the check.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The screen before and after the press, read by `assert`.
  let before;
  let after;

  return {
    id: "controls.pause-esc",

    async arrange(api) {
      await newGame(api);
    },

    async act(api) {
      before = (await api.snapshot()).screen;
      await api.call("press", "Escape");
      after = (await api.snapshot()).screen;
      // Hold on the paused game so the clip shows it stopped: 0.6 s x 120 Hz = 72 ticks.
      await api.advance(72);
    },

    async assert(api, check) {
      check.expectEq("the game is in play before pausing", before, "playing");
      check.expectEq("pressing Esc pauses the game", after, "paused");
    },
  };
}
