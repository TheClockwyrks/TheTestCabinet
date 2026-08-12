// Automated validation for the Lives item `extra-at-10000`: an extra ship is granted at
// each 10,000-point threshold. The score is set just below 10,000, then a real Small rock
// is destroyed (+100) to cross the threshold through the real scoring code, which must add
// a life.
//
// Posing the score, the lives and the target rock is instant (`arrange`); the kill that
// crosses the threshold is what consumes time (`act`), so the clip is the shot that earns the
// extra ship.

import { newGame, actFireUntilGone } from "../_helpers.mjs";

export default function item() {
  // The state just after the threshold-crossing kill, read by `assert`.
  let snap;

  return {
    id: "lives.extra-at-10000",

    async arrange(api) {
      await newGame(api);
      await api.call("setLives", 3);
      await api.call("setScore", 9990); // one Small kill from the 10,000 threshold
      await api.call("addRock", "small", { x: 400, y: 250, vx: 0, vy: 0 });
    },

    async act(api) {
      await actFireUntilGone(api, "small");
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "crossing 10,000 points scores through to 10,090",
        snap.score,
        10090,
      );
      check.expectEq(
        "crossing the 10,000-point threshold grants an extra ship",
        snap.lives,
        4,
      );
    },
  };
}
