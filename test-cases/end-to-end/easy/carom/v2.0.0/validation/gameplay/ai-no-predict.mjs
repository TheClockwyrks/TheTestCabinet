// Automated validation for the Gameplay sub-item `ai-no-predict`: in Solo the
// computer opponent does not predict bank shots — a fast, steep shot that banks off
// a wall before arriving gets past it.
//
// Drives the REAL AI (setAiControl, see specs/instrumentation.md) against a fast,
// steep shot fired up into the top wall: it banks there, then comes down to the goal.
// A reasonable opponent tracks the ball itself, so it chases the ball up toward the
// wall and cannot recover to the post-bounce arrival in time — the shot gets past it.
// An AI that predicts the reflected destination (or that moves faster than it should)
// would block it and fail this check.

import { arrangeAiScenario, actAiScenario } from "../_helpers.mjs";

const SCENARIO = { paddleCy: 360, ball: { x: 640, y: 360, vx: 520, vy: -820 } };

export default function item() {
  let r;

  return {
    id: "gameplay.ai-no-predict",

    // Pose the Solo match and the steep shot aimed into the top wall, then hand the
    // AI control of its own paddle so its real tracking — not a posed outcome —
    // decides whether it can recover to the ball's post-bounce arrival.
    async arrange(api) {
      await arrangeAiScenario(api, SCENARIO);
    },

    // The drive IS the clip — the reviewer sees the bank shot beat the AI paddle on
    // the same run whose outcome decides the verdict.
    async act(api) {
      r = await actAiScenario(api);
    },

    async assert(api, check) {
      check.expectEq(
        "a shot that banks off a wall gets past the AI, which tracks the ball rather than aiming at its post-bounce destination",
        r.result,
        "scored",
      );
    },
  };
}
