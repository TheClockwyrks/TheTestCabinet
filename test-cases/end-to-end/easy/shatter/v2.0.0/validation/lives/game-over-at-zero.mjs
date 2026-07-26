// Automated validation for the Lives item `game-over-at-zero`: losing the last ship ends
// the game. One life is left and a rock is placed on the ship with no invulnerability; the
// real collision ends the game, and the game-over screen is captured showing the final
// score.
//
// Posing the last ship, the score and the rock sitting on it is instant (`arrange`); letting
// the real collision resolve and end the run is the behavior (`act`), so the clip shows the
// game actually ending. The pause before the capture is `api.settle` — the game-over screen has
// to have been PAINTED for the screenshot to show it, which no amount of stepping produces.
//
// The sweep runs to 1 s x 120 Hz = 120 ticks and polls a single tick so the state read is the
// instant the run ends, not some way past it.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

export default function item() {
  // The state the instant the run ended, read by `assert`.
  let snap;

  return {
    id: "lives.game-over-at-zero",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 500);
      await api.call("setLives", 1); // the last ship
      await api.call("setInvuln", 0);
      await poseShip(api, { x: 300, y: 300, vx: 0, vy: 0, angle: 0 });
      await api.call("addRock", "small", { x: 300, y: 300, vx: 0, vy: 0 });
    },

    async act(api) {
      ({ snap } = await api.until((s) => s.screen !== "playing", {
        max: 120,
        poll: TICK,
      }));

      await api.settle(160); // let a frame paint the game-over screen
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectEq(
        "losing the last ship ends the game",
        snap.screen,
        "gameover",
      );
      check.expectEq("there are no ships left", snap.lives, 0);
      check.expectEq(
        "the final score is carried onto the game-over screen",
        snap.score,
        500,
      );
    },
  };
}
