// Automated validation for the Gameplay sub-item `scoring-p1`.
//
// A ball fully crossing the RIGHT goal edge (x > 1280) scores a point for player one
// (the left player) and increments only their score. The ball is aimed at the right
// goal (a precondition); the real simulation carries it across the edge and the real
// scoring code increments the score, which we read back. The left goal is covered by
// the sibling `scoring-p2` check, so a build that scores on only one edge fails the
// side it gets wrong rather than passing on an average.

import { arrangeGoal, actGoal, startPlaying } from "../_helpers.mjs";

export default function item() {
  let r;

  return {
    id: "gameplay.scoring-p1",

    // A live match on 0-0, with the paddles parked out of the lane and the ball
    // aimed down the clear y=360 lane at the right goal.
    async arrange(api) {
      await startPlaying(api);
      await api.call("setScore", 0, 0);
      await arrangeGoal(api, "right");
    },

    // Run the real physics until the point resolves. This IS the clip: the reviewer
    // watches the very ball whose crossing the assertions score.
    async act(api) {
      r = await actGoal(api);
      // `actGoal` returns the instant play leaves the field, which is the same
      // instant the point lands — so a clip that stopped there cut away before the
      // scoreboard could be read. Hold on the post-point countdown instead, where
      // the incremented score is on screen beside the re-held ball. The score was
      // captured above, so this cannot affect what is asserted.
      await api.advance(108); // 108 ticks (0.9s), inside the 1.0s post-point hold
    },

    // Right goal (x > 1280): player one (left) scores, and player two does not.
    async assert(api, check) {
      check.expectEq(
        "player one's score after a right-goal point",
        r.score.p1,
        1,
      );
      check.expectEq("player two's score is unchanged", r.score.p2, 0);
    },
  };
}
