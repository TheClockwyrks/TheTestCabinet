// Automated validation for the Controls item `pause-escape`.
//
// Pressing Escape during play pauses the game. A real run is started, then Escape
// is injected and the resulting screen read back. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default function item() {
  // The screen after the pause key.
  let screen;

  return {
    id: "controls.pause-escape",

    // Start a real run. Reaching live play is instant, so it belongs in `arrange`.
    async arrange(api) {
      await startCrossing(api);
    },

    // Play briefly, then pause — so the clip shows the pause landing over live play
    // rather than over a board that has not moved yet — and then HOLD on the paused
    // screen, for the reason in `pause-p`: without a tail the recording ends on the tick
    // the key was pressed and never shows the pause menu it is about. The reading is
    // taken before the tail, and a paused simulation is frozen (specs/controls.md), so
    // the tail is camera time and nothing else.
    async act(api) {
      await api.advance(60); // 0.5 s of live play before the pause
      await api.call("press", "Escape");
      screen = (await api.snapshot()).screen;
      await api.advance(150); // 1.25 s holding on the paused screen
    },

    async assert(api, check) {
      check.expectEq("pressing Escape pauses the game", screen, "paused");
    },
  };
}
