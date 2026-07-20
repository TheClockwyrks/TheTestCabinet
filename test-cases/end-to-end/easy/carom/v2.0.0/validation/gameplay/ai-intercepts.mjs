// Automated validation for the Gameplay sub-item `ai-intercepts`: in Solo the
// computer opponent is competent — a ball aimed to arrive a moderate distance from
// its paddle, within reach at its movement speed, is tracked down and blocked.
//
// Drives the REAL AI (setAiControl, see specs/instrumentation.md) against a shot
// aimed ~200 px off the AI paddle's start: a noticeable but coverable gap. The AI's
// own tracking, at its own speed, decides the outcome — a reachable shot must be
// blocked, so player one does not score.

import { driveAiScenario, clipAiScenario } from "../_helpers.mjs";

const SCENARIO = { paddleCy: 200, ball: { x: 640, y: 400, vx: 520 } };

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.ai-intercepts");

  const r = await driveAiScenario(api, SCENARIO);
  check.expectEq(
    "the AI tracks down a reachable shot and blocks it (player one does not score)",
    r.result,
    "blocked",
  );

  // A clip in real time so the reviewer sees the AI slide over and make the block.
  await clipAiScenario(api, SCENARIO);
  return check.verdict();
}
