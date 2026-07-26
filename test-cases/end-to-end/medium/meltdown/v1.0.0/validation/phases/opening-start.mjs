// Automated validation for the Phases sub-item `opening-start`.
//
// Pressing Start in the opening phase begins Wave 1 (specs/economy.md, states.md).
// We send from the opening phase and confirm the match enters the wave phase at
// wave 1.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let s;

  return {
    id: "phases.opening-start",

    // The untimed opening phase, with lives posed high so the wave it releases cannot
    // end the run under the check.
    async arrange(api) {
      await newGame(api, "containment", "medium");
      await api.call("setLives", 100000);
    },

    async act(api) {
      await api.call("startWave");
      s = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("Start begins the wave phase", s.phase, "wave");
      check.expectEq("it begins Wave 1", s.wave, 1);
    },
  };
}
