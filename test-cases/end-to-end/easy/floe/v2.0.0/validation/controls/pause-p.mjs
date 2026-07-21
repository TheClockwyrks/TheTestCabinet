// Automated validation for the Controls item `pause-p`.
//
// Pressing P during play pauses the game. A real run is started, then P is
// injected and the resulting screen read back. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The screen after the pause key.
  let screen;

  return {
    id: "controls.pause-p",

    // Start a real run. Reaching live play is instant, so it belongs in `arrange`.
    async arrange(api) {
      await startCrossing(api);
    },

    // Play briefly, then pause — so the clip shows the pause landing over live play
    // rather than over a board that has not moved yet.
    async act(api) {
      await api.advance(60); // 0.5 s of live play before the pause
      await api.call("press", "KeyP");
      screen = (await api.snapshot()).screen;
    },

    async assert(api, check) {
      check.expectEq("pressing P pauses the game", screen, "paused");
    },
  };
}
