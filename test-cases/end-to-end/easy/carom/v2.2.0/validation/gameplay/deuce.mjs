// Automated validation for the Gameplay sub-item `deuce`.
//
// At 10-10 (or any tie at/above 10) the match does not end at 11; play continues
// until one player leads by 2. Scores are set to 10-10 (a precondition), then real
// points are driven through the goal: the first takes it to 11-10 and must NOT end
// the match (only a 1-point lead), the second takes it to 12-10 and must end it.
// Both outcomes resolve through the real win rule, not a fabricated end state.

import { arrangeGoal, actGoal, startPlaying } from "../_helpers.mjs";

export default function item() {
  let atEleven;
  let atTwelve;

  return {
    id: "gameplay.deuce",

    // A live match posed at the deuce score, with the first point already aimed out
    // the right goal. The second point is re-posed inside `act` — `arrangeGoal` is
    // control ops only, so it is callable from either phase, and the point that
    // settles the match has to follow the one that did not.
    async arrange(api) {
      await startPlaying(api);
      await api.call("setScore", 10, 10);
      await arrangeGoal(api, "right");
    },

    // Both real points, back to back — which is exactly the clip the reviewer needs:
    // the 11-10 point that does NOT end the match, then the 12-10 point that does.
    async act(api) {
      // First real point for player one -> 11-10: a 1-point lead, so play continues.
      atEleven = await actGoal(api);

      // Second real point for player one -> 12-10: now a 2-point lead, match ends.
      // `serve` leaves the post-point countdown; `arrangeGoal` re-parks the paddles
      // and re-aims the ball for the second drive.
      await api.call("serve");
      await arrangeGoal(api, "right");
      atTwelve = await actGoal(api);
    },

    async assert(api, check) {
      check.expectNe(
        "11-10 does not end the match — a 1-point lead keeps playing (screen)",
        atEleven.screen,
        "matchover",
      );
      check.expectEq("no winner yet at 11-10", atEleven.winner, null);
      check.expectEq("player one's score at 11-10", atEleven.score.p1, 11);
      check.expectEq("player two's score at 11-10", atEleven.score.p2, 10);

      check.expectEq(
        "12-10 ends the match (screen)",
        atTwelve.screen,
        "matchover",
      );
      check.expectEq("player one wins at 12-10", atTwelve.winner, "left");
      check.expectEq("player one's final score", atTwelve.score.p1, 12);
      check.expectEq("player two's final score", atTwelve.score.p2, 10);
    },
  };
}
