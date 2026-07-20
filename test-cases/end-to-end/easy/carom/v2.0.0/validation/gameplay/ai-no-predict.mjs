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

import { driveAiScenario, clipAiScenario } from "../_helpers.mjs";

const SCENARIO = { paddleCy: 360, ball: { x: 640, y: 360, vx: 520, vy: -820 } };

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.ai-no-predict");

  const r = await driveAiScenario(api, SCENARIO);
  check.expectEq(
    "a shot that banks off a wall gets past the AI, which tracks the ball rather than aiming at its post-bounce destination",
    r.result,
    "scored",
  );

  // A clip in real time so the reviewer sees the bank shot beat the AI paddle.
  await clipAiScenario(api, SCENARIO);
  return check.verdict();
}
