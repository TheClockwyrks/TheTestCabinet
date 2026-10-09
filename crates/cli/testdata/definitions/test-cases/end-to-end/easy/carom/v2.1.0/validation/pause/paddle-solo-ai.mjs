// Automated validation for the Pause sub-item `paddle-solo-ai`: while the game is
// paused, the AI opponent's paddle (right, in Solo) does not move, even though the
// posed ball gives it something to chase.
//
// A Solo match is set up with the AI handed control of its paddle and a ball placed
// so the AI would chase it, then the game is paused. While paused the AI paddle must
// not move: the simulation is frozen. See validation/_helpers.mjs.

import { arrangeAiPaused, actAiPaused, STILL_MAX } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "pause.paddle-solo-ai",

    async arrange(api) {
      await arrangeAiPaused(api);
    },

    async act(api) {
      r = await actAiPaused(api);
    },

    async assert(api, check) {
      check.expectEq("the game is paused", r.screen, "paused");
      check.expectLt(
        "the AI paddle does not chase while paused (|Δcy|)",
        Math.abs(r.delta),
        STILL_MAX,
      );
    },
  };
}
