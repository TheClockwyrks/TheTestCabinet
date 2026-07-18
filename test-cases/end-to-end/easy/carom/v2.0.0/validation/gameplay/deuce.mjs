// Automated validation for the Gameplay sub-item `deuce`.
//
// At 10-10 (or any tie at/above 10) the match does not end at 11; play continues
// until one player leads by 2. Scores are set to 10-10 (a precondition), then real
// points are driven through the goal: the first takes it to 11-10 and must NOT end
// the match (only a 1-point lead), the second takes it to 12-10 and must end it.
// Both outcomes resolve through the real win rule, not a fabricated end state.

import {
  asserter,
  driveGoal,
  clearPaddles,
  startPlaying,
} from "../_helpers.mjs";

export default async function drive(api) {
  const rec = asserter();

  await startPlaying(api);
  await api.call("setScore", 10, 10);

  // First real point for player one -> 11-10: a 1-point lead, so play continues.
  const atEleven = await driveGoal(api, "right");
  rec.check(
    `11-10 does not end the match — a 1-point lead keeps playing (screen=${atEleven.screen}, ${atEleven.score.p1}-${atEleven.score.p2})`,
    atEleven.screen !== "matchover" &&
      atEleven.winner === null &&
      atEleven.score.p1 === 11 &&
      atEleven.score.p2 === 10,
  );

  // Second real point for player one -> 12-10: now a 2-point lead, match ends.
  await api.call("serve");
  const atTwelve = await driveGoal(api, "right");
  rec.check(
    `12-10 ends the match with player one winning (screen=${atTwelve.screen}, winner=${atTwelve.winner})`,
    atTwelve.screen === "matchover" &&
      atTwelve.winner === "left" &&
      atTwelve.score.p1 === 12 &&
      atTwelve.score.p2 === 10,
  );

  // A clip: the deuce point that finally settles the match at 12-10.
  await startPlaying(api);
  await api.call("setScore", 11, 10);
  await clearPaddles(api);
  await api.call("setBall", 0, { x: 900, y: 360, vx: 640, vy: 0, spin: 0 });
  await api.wait(1500);

  return { verdicts: { "gameplay.deuce": rec.assertions } };
}
