// Automated validation for the Scoring item `large-20`: destroying a Large rock scores
// 20. A single Large is posed on an empty field (score 0) and destroyed with the primary
// gun; the score is read back — only the destroying hit scores.
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
    id: "scoring.large-20",

    async arrange(api) {
      await arrangePosedRock(api, "large");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "large");
    },

    async assert(api, check) {
      check.expectEq(
        "destroying a Large rock scores 20",
        outcome.snap.score,
        ROCK_SCORE.large,
      );
    },
  };
}
