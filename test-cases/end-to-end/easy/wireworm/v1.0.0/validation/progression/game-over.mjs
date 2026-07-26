// Automated validation for progression.game-over: losing the last life ends the run
// on the Game-over screen, recording the level reached.
//
// One life and a worm segment on the cursor's tile are the preconditions; the end is
// produced by the real loseLife path (lives -> 0 -> gameover) when the sim steps, read
// back and captured.

import { freshBoard, setWorm } from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "progression.game-over",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 1);
      await api.call("setCursor", 640, 688); // tile (20,19)
      await setWorm(api, [{ c: 20, r: 19 }], 1, 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05s — one sim beat, enough for the touch
      snap = await api.snapshot();
      // The snapshot is captured; hold on the Game-over screen so the clip (and the
      // still below) show the state the assertions read.
      await api.advance(120); // 1s holding on the Game-over screen
      await api.settle(300); // a real pause so the screen has painted before the capture
      await api.screenshot("game-over");
    },

    async assert(api, check) {
      check.expectEq(
        "losing the last life ends the game",
        snap.screen,
        "gameover",
      );
      check.expectEq("no lives remain", snap.lives, 0);
      check.expectGt("the level reached is recorded", snap.reachedLevel, 0);
    },
  };
}
