// Automated validation for the UI item `state-gameover`: the game-over screen is
// reachable, and the debug API captures it. The last life is lost through the real
// flow (drowning) and the game-over screen read back and captured. The layout
// (play again / menu) is judged by eye.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The sweep that waited for the game-over screen.
  let r;

  return {
    id: "ui.state-gameover",

    // Pose the last life over open water, so the real flow reaches game over rather
    // than a respawn.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 1);
      await api.call("setLane", 5, { cols: [] });
      await api.call("placeCritter", 20, 5);
    },

    // Lose the life and let the game-over screen draw before capturing it.
    async act(api) {
      r = await api.until((s) => s.screen === "gameover", {
        max: 240,
        poll: 6,
      }); // 2 s at 0.05 s
      await api.advance(18); // 0.15 s, so the game-over screen has drawn
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectOk(
        "losing the last life reaches the game-over screen",
        r.hit,
      );
    },
  };
}
