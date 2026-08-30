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
      // Pause is only meaningful from live play, and `setLevel` is not specified to
      // land there instantly — a build that runs a level banner first would still be
      // showing it after a fixed 36-tick wait, and the press would be swallowed by a
      // screen that has nothing to pause. Wait for the phase the press needs instead
      // of assuming a timing the contract never promised.
      await api.until((s) => s.phase === "active", { max: 360, poll: 6 });
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
