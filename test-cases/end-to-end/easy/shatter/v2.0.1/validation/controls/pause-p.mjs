// Automated validation for the Controls item `pause-p`: the P key pauses the game (the
// alternate pause binding). A real game is in play; pressing P must move it to paused.
//
// Starting the game is the precondition (`arrange`); the press is the behavior (`act`), so
// the clip opens on a live game and shows it stop.

import { newGame } from "../_helpers.mjs";

export default function item() {
  // The screen before and after the press, read by `assert`.
  let before;
  let after;

  return {
    id: "controls.pause-p",

    async arrange(api) {
      await newGame(api);
    },

    async act(api) {
      before = (await api.snapshot()).screen;
      await api.call("press", "KeyP");
      after = (await api.snapshot()).screen;
      // Hold on the paused game so the clip shows it stopped: 0.6 s x 120 Hz = 72 ticks.
      await api.advance(72);
    },

    async assert(api, check) {
      check.expectEq("the game is in play before pausing", before, "playing");
      check.expectEq("pressing P pauses the game", after, "paused");
    },
  };
}
