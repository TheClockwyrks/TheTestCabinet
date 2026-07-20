// Automated validation for ui.state-gameover: the Game-over screen is reachable, and
// the debug API captures it. The layout is judged by eye from the capture. The state
// is reached the real way — losing the last life.

import { freshBoard, setWorm } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "ui.state-gameover",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLives", 1);
      await api.call("setCursor", 640, 688);
      await setWorm(api, [{ c: 20, r: 19 }], 1, 1);
    },

    async act(api) {
      await api.advance(6); // 6 ticks = the old 0.05s — one sim beat, enough for the touch
      screen = (await api.snapshot()).screen;
      await api.settle(300); // a real pause so the Game-over screen has painted
      await api.screenshot("gameover");
    },

    async assert(api, check) {
      check.expectEq("the Game-over screen is reachable", screen, "gameover");
    },
  };
}
