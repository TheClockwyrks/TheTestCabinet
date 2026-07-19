// Automated validation for the Gameplay sub-item `scoring-p1`.
//
// A ball fully crossing the RIGHT goal edge (x > 1280) scores a point for player one
// (the left player) and increments only their score. The ball is aimed at the right
// goal (a precondition); the real simulation carries it across the edge and the real
// scoring code increments the score, which we read back. The left goal is covered by
// the sibling `scoring-p2` check, so a build that scores on only one edge fails the
// side it gets wrong rather than passing on an average.

import { driveGoal, clearPaddles, startPlaying } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.scoring-p1");

  await startPlaying(api);
  await api.call("setScore", 0, 0);

  // Right goal (x > 1280): player one (left) scores, and player two does not.
  const r = await driveGoal(api, "right");
  check.expectEq("player one's score after a right-goal point", r.score.p1, 1);
  check.expectEq("player two's score is unchanged", r.score.p2, 0);

  // A clip: a ball crossing the right goal and scoring for player one.
  await api.call("serve");
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 900, y: 360, vx: 620, vy: 0, spin: 0 });
  await api.call("setAutoStep", true); // hand the clock back so the clip animates
  await api.wait(1500);

  return check.verdict();
}
