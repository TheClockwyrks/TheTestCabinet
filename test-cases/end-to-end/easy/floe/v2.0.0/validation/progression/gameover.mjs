// Automated validation for the Progression item `gameover`.
//
// Losing the last life ends the game (the game-over screen appears). Lives are set
// to one and a death driven; the real flow reaches game over, which the snapshot
// reads back and a screenshot captures. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The sweep that waited for the game-over screen.
  let r;

  return {
    id: "progression.gameover",

    // Pose the last life: one life left and the critter standing over open water, so
    // the next death is the one that ends the run.
    async arrange(api) {
      await startCrossing(api);
      await api.call("setLives", 1);
      await api.call("setLane", 5, { cols: [] }); // open water -> drown the last life
      await api.call("placeCritter", 20, 5);
    },

    // The drowning and the run ending — what is checked, and what the capture shows.
    async act(api) {
      r = await api.until((s) => s.screen === "gameover", {
        max: 240,
        poll: 6,
      }); // 2 s at 0.05 s
      await api.advance(18); // 0.15 s, so the game-over screen has drawn
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectOk("losing the last life ends the game", r.hit);
      check.expectEq("the game-over screen appears", r.snap.screen, "gameover");
    },
  };
}
