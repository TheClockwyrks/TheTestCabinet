// Automated validation for the Pause sub-item `paddle-solo-player`: while the game is
// paused, the human paddle (left, in Solo) does not move even with a movement key
// held.
//
// A Solo match is started from the title with injected keys, paused, and then a
// movement key is held. The paddle must not budge while paused (the simulation is
// frozen), so its Δcy over the held span is ~0. See validation/_helpers.mjs.

import { startWithKeys, actPausedHold, STILL_MAX } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "pause.paddle-solo-player",

    async arrange(api) {
      await startWithKeys(api, "solo");
    },

    async act(api) {
      r = await actPausedHold(api, "left", "KeyS");
    },

    async assert(api, check) {
      check.expectEq("the game is paused", r.screen, "paused");
      check.expectLt(
        "holding a movement key while paused does not move the left paddle (|Δcy|)",
        Math.abs(r.delta),
        STILL_MAX,
      );
    },
  };
}
