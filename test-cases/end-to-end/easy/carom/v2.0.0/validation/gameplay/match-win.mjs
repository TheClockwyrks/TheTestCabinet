// Automated validation for the Gameplay sub-item `match-win`.
//
// Reaching 11 points with at least a 2-point lead ends the match and shows the
// match-over screen with the correct winner and final score. The scores are set to
// 10-9 as a precondition, then a REAL point is driven across the goal — the win
// rule resolves through the real scoring code (not a fabricated end state), taking
// the score to 11-9 and the match to matchover.

import { arrangeGoal, actGoal, startPlaying } from "../_helpers.mjs";

export default function item() {
  let end;

  return {
    id: "gameplay.match-win",

    // A live match posed at 10-9, with a real point aimed out the right goal: the
    // point takes player one to 11-9, which is 11 points with a lead of exactly 2 —
    // the narrowest score that satisfies the win rule.
    async arrange(api) {
      await startPlaying(api);
      await api.call("setScore", 10, 9);
      await arrangeGoal(api, "right");
    },

    // Drive the real point for player one (ball out the right goal) -> 11-9, lead 2.
    // This IS the clip: the reviewer watches the match point land, and the match-over
    // screen is then captured as the expected-vs-observed still.
    async act(api) {
      end = await actGoal(api);
      await api.advance(48); // 48 ticks = the old 400ms hold before the capture
      await api.screenshot("game-over");
    },

    async assert(api, check) {
      check.expectEq(
        "match screen after the match point",
        end.screen,
        "matchover",
      );
      check.expectEq("winner is player one", end.winner, "left");
      check.expectEq("final p1 score", end.score.p1, 11);
      check.expectEq("final p2 score", end.score.p2, 9);
    },
  };
}
