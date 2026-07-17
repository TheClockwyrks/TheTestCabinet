// Automated validation for the Gameplay sub-item `deuce`.
//
// At 10-10 (or any tie at/above 10) the match does not end at 11; play continues
// until one player leads by 2. Scores are set to 10-10 (a precondition), then real
// points are driven through the goal: the first takes it to 11-10 and must NOT end
// the match (only a 1-point lead), the second takes it to 12-10 and must end it.
// Both outcomes resolve through the real win rule, not a fabricated end state.

import { driveGoal, startPlaying } from "../_helpers.mjs";

export default async function drive(api) {
  await startPlaying(api);
  await api.call("setScore", 10, 10);

  // First real point for player one -> 11-10: a 1-point lead, so play continues.
  const atEleven = await driveGoal(api, "right");
  const deuceHeld =
    atEleven.screen !== "matchover" &&
    atEleven.winner === null &&
    atEleven.score.p1 === 11 &&
    atEleven.score.p2 === 10;

  // Second real point for player one -> 12-10: now a 2-point lead, match ends.
  await api.call("serve");
  const atTwelve = await driveGoal(api, "right");
  const thenWins =
    atTwelve.screen === "matchover" &&
    atTwelve.winner === "left" &&
    atTwelve.score.p1 === 12 &&
    atTwelve.score.p2 === 10;

  const pass = deuceHeld && thenWins;

  return {
    verdicts: { "gameplay.deuce": pass },
    notes: {
      "gameplay.deuce": `11-10 -> screen=${atEleven.screen} (no matchover, continues); 12-10 -> screen=${atTwelve.screen}, winner=${atTwelve.winner}`,
    },
  };
}
