// Automated validation for the UI sub-item `state-gameover`: the game-over screen is
// reachable, and captured for the reviewer.
//
// Lives are posed to one and a real lethal hit taken (an opposite-band bullet on the
// ship); losing the last life ends the game through the real path, landing on the
// game-over screen, which is read back and captured.

import { startClean, shieldBullet } from "../_helpers.mjs";

export default function item() {
  // The moment the game ended.
  let r;

  return {
    id: "ui.state-gameover",

    // One life left and a lethal (opposite-band) bullet already on its way, so the
    // game-over is reached through the real death path rather than posed directly.
    async arrange(api) {
      await startClean(api);
      await api.call("setShipBand", "cyan");
      await api.call("setLives", 1);
      await shieldBullet(api, "magenta"); // opposite the ship's band -> lethal
    },

    async act(api) {
      r = await api.until((s) => s.screen === "gameOver", { max: 60 }); // 60 ticks = the old 0.5 s

      // A real pause so the game-over screen has been painted before it is captured.
      await api.settle(120);
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
