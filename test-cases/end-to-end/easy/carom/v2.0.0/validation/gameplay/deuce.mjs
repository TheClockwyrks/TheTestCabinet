// Automated validation for the Gameplay sub-item `deuce`.
//
// At 10-10 (or any tie at/above 10) the match does not end at 11; play continues
// until one player leads by 2. Scores are set to 10-10 (a precondition), then real
// points are driven through the goal: the first takes it to 11-10 and must NOT end
// the match (only a 1-point lead), the second takes it to 12-10 and must end it.
// Both outcomes resolve through the real win rule, not a fabricated end state.

import { driveGoal, clearPaddles, startPlaying } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.deuce");

  await startPlaying(api);
  await api.call("setScore", 10, 10);

  // First real point for player one -> 11-10: a 1-point lead, so play continues.
  const atEleven = await driveGoal(api, "right");
  check.expectNe(
    "11-10 does not end the match — a 1-point lead keeps playing (screen)",
    atEleven.screen,
    "matchover",
  );
  check.expectEq("no winner yet at 11-10", atEleven.winner, null);
  check.expectEq("player one's score at 11-10", atEleven.score.p1, 11);
  check.expectEq("player two's score at 11-10", atEleven.score.p2, 10);

  // Second real point for player one -> 12-10: now a 2-point lead, match ends.
  await api.call("serve");
  const atTwelve = await driveGoal(api, "right");
  check.expectEq("12-10 ends the match (screen)", atTwelve.screen, "matchover");
  check.expectEq("player one wins at 12-10", atTwelve.winner, "left");
  check.expectEq("player one's final score", atTwelve.score.p1, 12);
  check.expectEq("player two's final score", atTwelve.score.p2, 10);

  // A clip: the deuce point that finally settles the match at 12-10.
  await startPlaying(api);
  await api.call("setScore", 11, 10);
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 900, y: 360, vx: 640, vy: 0, spin: 0 });
  await api.call("setAutoStep", true); // hand the clock back so the clip animates
  await api.wait(1500);

  return check.verdict();
}
