// Automated validation for ui.state-pause: the pause menu is reachable from live
// play, and the debug API captures it. The layout (resume / restart / quit) is judged
// by eye from the capture.

import { freshBoard } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "ui.state-pause",

    async arrange(api) {
      await freshBoard(api);
      await api.call("setLevel", 1); // a live board behind the pause
    },

    async act(api) {
      await api.advance(36); // 36 ticks = the old 0.3s of live play behind the pause
      await api.call("press", "KeyP");
      await api.settle(150); // a real pause so the pause menu has painted
      screen = (await api.snapshot()).screen;
      await api.screenshot("pause");
    },

    async assert(api, check) {
      check.expectEq(
        "pausing during play reaches the pause menu",
        screen,
        "paused",
      );
    },
  };
}
