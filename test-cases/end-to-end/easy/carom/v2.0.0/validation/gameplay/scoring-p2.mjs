// Automated validation for the Gameplay sub-item `scoring-p2`.
//
// A ball fully crossing the LEFT goal edge (x < 0) scores a point for player two
// (the right player) and increments only their score. The ball is aimed at the left
// goal (a precondition); the real simulation carries it across the edge and the real
// scoring code increments the score, which we read back. The right goal is covered by
// the sibling `scoring-p1` check, so a build that scores on only one edge fails the
// side it gets wrong rather than passing on an average.

import { driveGoal, clearPaddles, startPlaying } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.scoring-p2");

  await startPlaying(api);
  await api.call("setScore", 0, 0);

  // Left goal (x < 0): player two (right) scores, and player one does not.
  const r = await driveGoal(api, "left");
  check.expectEq("player two's score after a left-goal point", r.score.p2, 1);
  check.expectEq("player one's score is unchanged", r.score.p1, 0);

  // A clip: a ball crossing the left goal and scoring for player two.
  await api.call("serve");
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 380, y: 360, vx: -620, vy: 0, spin: 0 });
  await api.wait(1500);

  return check.verdict();
}
