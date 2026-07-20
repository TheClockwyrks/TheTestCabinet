// Automated validation for the Gameplay sub-item `match-win`.
//
// Reaching 11 points with at least a 2-point lead ends the match and shows the
// match-over screen with the correct winner and final score. The scores are set to
// 10-9 as a precondition, then a REAL point is driven across the goal — the win
// rule resolves through the real scoring code (not a fabricated end state), taking
// the score to 11-9 and the match to matchover.

import { driveGoal, startPlaying } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.match-win");

  await startPlaying(api);
  await api.call("setScore", 10, 9);

  // Drive a real point for player one (ball out the right goal) -> 11-9, lead 2.
  const end = await driveGoal(api, "right");

  check.expectEq("match screen after the match point", end.screen, "matchover");
  check.expectEq("winner is player one", end.winner, "left");
  check.expectEq("final p1 score", end.score.p1, 11);
  check.expectEq("final p2 score", end.score.p2, 9);

  // Capture the match-over screen as the reviewer's expected-vs-observed still.
  await api.wait(400);
  await api.screenshot("game-over");

  return check.verdict();
}
