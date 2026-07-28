// Automated validation for the Controls sub-item `send-wave`.
//
// Space starts / sends the next wave (specs/controls.md). From the opening phase,
// pressing Space begins Wave 1.

import { newGame, press, actTail } from "../_helpers.mjs";

export default function item() {
  let s;

  return {
    id: "controls.send-wave",

    // The untimed opening phase, with lives posed high so the wave that Space
    // releases cannot end the run under the check.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 100000);
    },

    async act(api) {
      await press(api, "Space");
      s = await api.snapshot();

      // A key press and the state it leaves behind both resolve instantly, so without
      // this the clip is a still frame of a game that never visibly does anything —
      // three seconds of the result on screen is what makes it reviewable.
      await actTail(api, 180);
    },

    async assert(api, check) {
      check.expectEq("Space starts the wave phase", s.phase, "wave");
      check.expectEq("it begins Wave 1", s.wave, 1);
    },
  };
}
