// Controls: Esc during a live shift opens the pause screen.

import { startFresh } from "../_helpers.mjs";

export default function item() {
  // The screen either side of the Esc press.
  let screenBefore;
  let screenAfter;

  return {
    id: "controls.pause",

    // Enter the shift and read that it is live before the pause. Both instant.
    async arrange(api) {
      await startFresh(api, 1);
      screenBefore = (await api.snapshot()).screen;
    },

    // The pause itself, then a hold on the paused game so the clip shows the pause
    // screen rather than the single frame it opened on. Stepping has no effect on a
    // menu screen, so the hold cannot advance the shift behind the menu.
    // 42 ticks = the old 700ms clip hold.
    async act(api) {
      await api.call("press", "Escape");
      screenAfter = (await api.snapshot()).screen;

      await api.advance(42);
    },

    async assert(api, check) {
      check.expectEq(
        "the shift is live before the pause",
        screenBefore,
        "playing",
      );
      check.expectEq("pressing Esc pauses the shift", screenAfter, "pause");
    },
  };
}
