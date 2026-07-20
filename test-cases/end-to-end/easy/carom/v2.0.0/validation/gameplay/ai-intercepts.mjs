// Automated validation for the Gameplay sub-item `ai-intercepts`: in Solo the
// computer opponent is competent — a ball aimed to arrive a moderate distance from
// its paddle, within reach at its movement speed, is tracked down and blocked.
//
// Drives the REAL AI (setAiControl, see specs/instrumentation.md) against a shot
// aimed ~200 px off the AI paddle's start: a noticeable but coverable gap. The AI's
// own tracking, at its own speed, decides the outcome — a reachable shot must be
// blocked, so player one does not score.

import { arrangeAiScenario, actAiScenario } from "../_helpers.mjs";

const SCENARIO = { paddleCy: 200, ball: { x: 640, y: 400, vx: 520 } };

export default function item() {
  let r;

  return {
    id: "gameplay.ai-intercepts",

    // Pose the Solo match, the shot's approach and the AI paddle's start, then hand
    // the AI control of its own paddle. Nothing has moved yet: it is running time
    // forward that pits the real opponent against the shot.
    async arrange(api) {
      await arrangeAiScenario(api, SCENARIO);
    },

    // The drive IS the clip — the reviewer watches the AI slide over and make the
    // block on the same run whose outcome decides the verdict.
    async act(api) {
      r = await actAiScenario(api);
    },

    async assert(api, check) {
      check.expectEq(
        "the AI tracks down a reachable shot and blocks it (player one does not score)",
        r.result,
        "blocked",
      );
    },
  };
}
