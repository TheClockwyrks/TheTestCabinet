// Automated validation for the UI item `state-pause`: the pause menu is reachable,
// and the debug API captures it. A live run is paused and the pause screen read
// back and captured. The layout (resume/restart/quit) is judged by eye.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The screen after the pause key.
  let screen;

  return {
    id: "ui.state-pause",

    // Start a real run. Reaching live play is instant, so it belongs in `arrange`.
    async arrange(api) {
      await startCrossing(api);
    },

    // Let the run play a moment first, so the capture shows the pause menu over live
    // play rather than over a board that has not moved yet.
    async act(api) {
      await api.advance(36); // 0.3 s of live play before the pause
      await api.call("press", "KeyP");
      // 0.12 s is 14.4 ticks, which the tick contract rejects rather than rounds. This
      // is a settle so the pause menu has drawn, so it rounds UP to 15 — never shorter.
      await api.advance(15);
      screen = (await api.snapshot()).screen;
      await api.screenshot("pause");
    },

    async assert(api, check) {
      check.expectEq(
        "pausing a live run opens the pause menu",
        screen,
        "paused",
      );
    },
  };
}
