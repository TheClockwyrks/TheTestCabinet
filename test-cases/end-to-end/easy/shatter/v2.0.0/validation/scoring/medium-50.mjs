// Automated validation for the Scoring item `medium-50`: destroying a Medium rock scores
// 50. A single Medium is posed on an empty field (score 0) and destroyed; the score is
// read back.
//
// Posing the isolated rock is instant (`arrange`); the shot that destroys it is what consumes
// time (`act`), so the clip is the kill whose score the check reads.

import {
  arrangePosedRock,
  actFireUntilGone,
  ROCK_SCORE,
} from "../_helpers.mjs";

export default function item() {
  // The state just after the rock died, read by `assert`.
  let outcome;

  return {
    id: "scoring.medium-50",

    async arrange(api) {
      await arrangePosedRock(api, "medium");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "medium");
    },

    async assert(api, check) {
      check.expectEq(
        "destroying a Medium rock scores 50",
        outcome.snap.score,
        ROCK_SCORE.medium,
      );
    },
  };
}
