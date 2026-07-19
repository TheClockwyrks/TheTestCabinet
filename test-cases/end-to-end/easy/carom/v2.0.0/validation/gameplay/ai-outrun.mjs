// Automated validation for the Gameplay sub-item `ai-outrun`: in Solo the computer
// opponent is clearly beatable and not superhuman — a fast shot placed well out of
// its reach gets past it and scores.
//
// Drives the REAL AI (setAiControl, see specs/instrumentation.md) against a fast,
// low-angle shot arriving near the top while the AI paddle starts pinned at the
// bottom. The ball reaches the goal line before a paddle moving at the AI's speed
// could cover the distance, so a correctly-paced opponent misses it. An AI that
// moves faster than it should would block it and fail this check.

import { driveAiScenario, clipAiScenario } from "../_helpers.mjs";

const SCENARIO = { paddleCy: 665, ball: { x: 700, y: 150, vx: 940, vy: 40 } };

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.ai-outrun");

  const r = await driveAiScenario(api, SCENARIO);
  check.expectEq(
    "a fast shot placed out of the AI's reach gets past it and scores",
    r.result,
    "scored",
  );

  // A clip in real time so the reviewer sees the ball outrun the AI paddle.
  await clipAiScenario(api, SCENARIO);
  return check.verdict();
}
