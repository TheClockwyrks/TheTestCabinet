// Automated validation for the Gameplay sub-item `ai-outrun`: in Solo the computer
// opponent is clearly beatable and not superhuman — a fast shot placed well out of
// its reach gets past it and scores.
//
// Drives the REAL AI (setAiControl, see specs/instrumentation.md) against a fast,
// low-angle shot arriving near the top while the AI paddle starts pinned at the
// bottom. The ball reaches the goal line before a paddle moving at the AI's speed
// could cover the distance, so a correctly-paced opponent misses it. An AI that
// moves faster than it should would block it and fail this check.

import { arrangeAiScenario, actAiScenario } from "../_helpers.mjs";

const SCENARIO = { paddleCy: 665, ball: { x: 700, y: 150, vx: 940, vy: 40 } };

export default function item() {
  let r;

  return {
    id: "gameplay.ai-outrun",

    // Pose the Solo match with the AI paddle pinned at the bottom bound and the shot
    // arriving near the top, then hand the AI control of its own paddle so its real
    // movement speed decides whether it can cover the distance in time.
    async arrange(api) {
      await arrangeAiScenario(api, SCENARIO);
    },

    // The drive IS the clip — the reviewer sees the ball outrun the AI paddle on the
    // same run whose outcome decides the verdict.
    async act(api) {
      r = await actAiScenario(api);
    },

    async assert(api, check) {
      check.expectEq(
        "a fast shot placed out of the AI's reach gets past it and scores",
        r.result,
        "scored",
      );
    },
  };
}
