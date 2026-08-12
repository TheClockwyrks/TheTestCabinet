// Automated validation for the UI item `state-gameover`: the game-over screen is reachable
// and correct, captured for review. A real game is driven to its end — its first wave allowed
// to spawn, then every ship spent to real collisions — and the game-over state is read back,
// showing the final score and the wave reached.
//
// The wave is waited for rather than assumed. `specs/instrumentation.md` puts the wave number
// at "0 before the first spawns" and `specs/ui.md` opens each wave with a banner, so a build
// that shows `WAVE 1` and then spawns it is reporting 0 for the first moment of a new game —
// correctly. Ending the run before that turnover would read a 0 off the game-over screen and
// call the build wrong for a wave it did reach.
//
// The ships are spent one at a time rather than the count being short-circuited: what the
// `lives` number counts is a convention the spec leaves open (see `_helpers.mjs`), while "the
// last ship's loss ends the run" is not.
//
// Setting the score is the precondition (`arrange`); reaching the first wave and then ending
// the run are the behavior (`act`), so the clip shows the game actually ending rather than
// opening on an already-final screen. The pause before the capture is `api.settle` — the
// game-over screen has to have been PAINTED for the screenshot to show it, which no amount of
// stepping produces.

import { newGame, actLoseEveryShip, TICK, ticks } from "../_helpers.mjs";

const SCORE = 1234;

export default function item() {
  // Whether the first wave arrived, and what spending every ship did.
  let waved;
  let run;

  return {
    id: "ui.state-gameover",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", SCORE);
      // Reaching the first wave is the journey, not the evidence: skip to it so the
      // clip opens on a game in progress rather than on its opening banner.
      waved = await api.skipUntil((s) => s.wave >= 1, {
        max: ticks(5),
        poll: TICK,
      });
    },

    async act(api) {
      run = await actLoseEveryShip(api);

      await api.settle(160); // let a frame paint the game-over screen
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectOk("the game reaches its first wave", waved.hit);
      check.expectEq(
        "losing the last ship reaches the game-over screen",
        run.snap.screen,
        "gameover",
      );
      check.expectEq(
        "the game-over screen carries the final score",
        run.snap.score,
        SCORE,
      );
      check.expectGt(
        "the game-over screen carries the wave reached",
        run.snap.wave,
        0,
      );
    },
  };
}
