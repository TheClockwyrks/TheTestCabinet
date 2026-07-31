// Automated validation for the Scoring item `monotonic`: over a driven kill sequence the
// HUD score only ever rises. Three Small rocks are destroyed one after another on an empty
// field; the score is sampled after each and must climb strictly through 100, 200, 300.
//
// Only the clean, zeroed session is a precondition (`arrange`). Each rock is posed and shot
// inside `act`: `addRock` is a control op, which is legal there, and the three kills in
// sequence are precisely the behavior under test, so the clip is the run of kills whose scores
// the check reads.

import { newGame, actFireUntilGone, ROCK_SCORE } from "../_helpers.mjs";

export default function item() {
  // The score after each of the three kills, read by `assert`.
  let scores;

  return {
    id: "scoring.monotonic",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 0);
    },

    async act(api) {
      scores = [];
      for (let i = 0; i < 3; i += 1) {
        await api.call("addRock", "small", { x: 400, y: 250, vx: 0, vy: 0 });
        // A short dwell per kill rather than the helper's default: three of them run
        // back to back here, and the run has to stay inside the stretch this scenario
        // set up — long enough and the game's own next wave arrives mid-sequence and
        // starts putting rocks in front of the shots.
        await actFireUntilGone(api, "small", { dwell: 30 });
        scores.push((await api.snapshot()).score);
      }
      await api.advance(90); // 0.75 s tail, so the clip ends on the final score
    },

    async assert(api, check) {
      check.expectEq("the first kill scores 100", scores[0], ROCK_SCORE.small);
      check.expectGt(
        "the score rises on the second kill",
        scores[1],
        scores[0],
      );
      check.expectGt(
        "the score rises again on the third kill",
        scores[2],
        scores[1],
      );
      check.expectEq(
        "three Small kills total 300",
        scores[2],
        3 * ROCK_SCORE.small,
      );
    },
  };
}
