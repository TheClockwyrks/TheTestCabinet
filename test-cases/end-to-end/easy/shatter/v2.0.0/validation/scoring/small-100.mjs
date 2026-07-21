// Automated validation for the Scoring item `small-100`: destroying a Small rock scores
// 100. A single Small is posed on an empty field (score 0) and destroyed; the score is
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
    id: "scoring.small-100",

    async arrange(api) {
      await arrangePosedRock(api, "small");
    },

    async act(api) {
      outcome = await actFireUntilGone(api, "small");
    },

    async assert(api, check) {
      check.expectEq(
        "destroying a Small rock scores 100",
        outcome.snap.score,
        ROCK_SCORE.small,
      );
    },
  };
}
