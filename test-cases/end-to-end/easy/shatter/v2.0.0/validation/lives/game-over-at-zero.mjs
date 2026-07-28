// Automated validation for the Lives item `game-over-at-zero`: losing the last ship ends
// the game. A real game's ships are spent one at a time until the run is over, and the
// game-over screen is captured showing the final score.
//
// The ships are actually spent rather than the count being short-circuited with
// `setLives(0)`. Doing it by hand would make the check depend on a convention the spec never
// picks: `specs/instrumentation.md` calls the count "ships in reserve" (so 0 leaves one still
// flying) while `specs/gameplay.md` counts three ships in total, and against a build reading
// it the other way `setLives(0)` can end the run with no ship ever lost — the check would pass
// on a game that never proved the rule. Losing every ship states the rule directly: whatever
// the count means, the loss of the last one ends the run.
//
// Setting the score is the precondition (`arrange`); spending the ships is the behavior
// (`act`), so the clip shows the game actually ending. The pause before the capture is
// `api.settle` — the game-over screen has to have been PAINTED for the screenshot to show it,
// which no amount of stepping produces.

import { newGame, actLoseEveryShip } from "../_helpers.mjs";

const SCORE = 500;

export default function item() {
  // What spending every ship did, read by `assert`.
  let run;

  return {
    id: "lives.game-over-at-zero",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", SCORE);
    },

    async act(api) {
      run = await actLoseEveryShip(api);

      await api.settle(160); // let a frame paint the game-over screen
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectOk("losing the last ship ends the game", run.ended);
      check.expectEq(
        "the run reaches the game-over screen",
        run.snap.screen,
        "gameover",
      );
      check.expectLe("there are no ships left", run.snap.lives, 0);
      check.expectEq(
        "the final score is carried onto the game-over screen",
        run.snap.score,
        SCORE,
      );
    },
  };
}
