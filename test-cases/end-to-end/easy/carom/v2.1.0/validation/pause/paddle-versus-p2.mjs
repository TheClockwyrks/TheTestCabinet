// Automated validation for the Pause sub-item `paddle-versus-p2`: while the game is
// paused, player two's paddle (right, in Versus) does not move even with a movement
// key held.
//
// A Versus match is started from the title with injected keys, paused, and then the
// Down arrow is held. The right paddle must not budge while paused, so its Δcy over
// the held span is ~0. See validation/_helpers.mjs.

import { startWithKeys, actPausedHold, STILL_MAX } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "pause.paddle-versus-p2",

    async arrange(api) {
      await startWithKeys(api, "versus");
    },

    async act(api) {
      r = await actPausedHold(api, "right", "ArrowDown");
    },

    async assert(api, check) {
      check.expectEq("the game is paused", r.screen, "paused");
      check.expectLt(
        "holding a movement key while paused does not move player two's paddle (|Δcy|)",
        Math.abs(r.delta),
        STILL_MAX,
      );
    },
  };
}
