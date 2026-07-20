// Automated validation for the Controls sub-item `send-wave`.
//
// Space starts / sends the next wave (specs/controls.md). From the opening phase,
// pressing Space begins Wave 1.

import { newGame, press } from "../_helpers.mjs";

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
    },

    async assert(api, check) {
      check.expectEq("Space starts the wave phase", s.phase, "wave");
      check.expectEq("it begins Wave 1", s.wave, 1);
    },
  };
}
