// Automated validation for the Gameplay sub-item `match-win`.
//
// Reaching 11 points with at least a 2-point lead ends the match and shows the
// match-over screen with the correct winner and final score. The scores are set to
// 10-9 as a precondition, then a REAL point is driven across the goal — the win
// rule resolves through the real scoring code (not a fabricated end state), taking
// the score to 11-9 and the match to matchover.

import { asserter, driveGoal, startPlaying } from "../_helpers.mjs";

export default async function drive(api) {
  const rec = asserter();

  await startPlaying(api);
  await api.call("setScore", 10, 9);

  // Drive a real point for player one (ball out the right goal) -> 11-9, lead 2.
  const end = await driveGoal(api, "right");

  rec.check(
    `the match ends at 11-9 (screen=${end.screen})`,
    end.screen === "matchover",
  );
  rec.check(`player one wins (winner=${end.winner})`, end.winner === "left");
  rec.check(
    `final score is 11-9 (${end.score.p1}-${end.score.p2})`,
    end.score.p1 === 11 && end.score.p2 === 9,
  );

  // Capture the match-over screen as the reviewer's expected-vs-observed still.
  await api.wait(400);
  await api.screenshot("game-over");

  return { verdicts: { "gameplay.match-win": rec.assertions } };
}
