// Automated validation for the Paddle Movement sub-item `speed-solo-ai`.
//
// The AI opponent's paddle (right, in Solo) chases the ball at its own movement speed
// — competent, but deliberately slower than the human's 720 px/s so it stays beatable
// (modes.md). The real AI is handed control of its paddle (setAiControl) and given a
// ball far in y to chase; the distance it covers over a short window while chasing at
// full speed is measured back into a speed. Nothing poses the AI's motion — its own
// tracking, at its own speed, is what is measured. See validation/_helpers.mjs.

import {
  arrangeAiChase,
  actAiChaseSpeed,
  assertAiSpeed,
} from "../_helpers.mjs";

export default function item() {
  let chase;

  return {
    id: "paddle-movement.speed-solo-ai",

    async arrange(api) {
      await arrangeAiChase(api);
    },

    async act(api) {
      chase = await actAiChaseSpeed(api);
    },

    async assert(api, check) {
      assertAiSpeed(check, chase);
    },
  };
}
