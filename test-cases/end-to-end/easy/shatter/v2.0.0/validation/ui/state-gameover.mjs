// Automated validation for the UI item `state-gameover`: the game-over screen is reachable
// and correct, captured for review. A real game is driven to its end (last ship lost to a
// real collision); the game-over state is read back — showing the final score and the wave
// reached — and captured.
//
// Posing the last ship, its score and the rock sitting on it is instant (`arrange`); letting the
// real collision end the run is the behavior (`act`), so the clip shows the game actually
// ending rather than opening on an already-final screen. The pause before the capture is
// `api.settle` — the game-over screen has to have been PAINTED for the screenshot to show it,
// which no amount of stepping produces.
//
// The sweep runs to 1 s x 120 Hz = 120 ticks and polls a single tick so the state read is the
// instant the run ends.

import { newGame, poseShip, TICK } from "../_helpers.mjs";

export default function item() {
  // The state the instant the run ended, read by `assert`.
  let snap;

  return {
    id: "ui.state-gameover",

    async arrange(api) {
      await newGame(api);
      await api.call("setScore", 1234);
      await api.call("setLives", 1);
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
        "losing the last ship reaches the game-over screen",
        snap.screen,
        "gameover",
      );
      check.expectEq(
        "the game-over screen carries the final score",
        snap.score,
        1234,
      );
      check.expectGt(
        "the game-over screen carries the wave reached",
        snap.wave,
        0,
      );
    },
  };
}
