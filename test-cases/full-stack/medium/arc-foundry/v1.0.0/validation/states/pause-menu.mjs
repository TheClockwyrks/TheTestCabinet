// Automated validation for states.pause-menu: the Esc pause menu is reachable over a frozen
// board (Resume / Restart / Quit), distinct from the in-place pause.
//
// Opening the run is the arrange; the ESC PRESS that opens the menu is the behavior under test
// and is the act.

import { startBuild, snap } from "../_helpers.mjs";

// Let the menu paint over the frozen board before the still. 100 ms x 60 Hz = 6 ticks exactly.
const SETTLE_TICKS = 6;

export default function item() {
  // The screen the Esc press landed on, read by `assert`.
  let screen;

  return {
    id: "states.pause-menu",

    async arrange(api) {
      await startBuild(api); // playing, opening build phase, nothing held or selected
    },

    async act(api) {
      await api.call("press", "Escape"); // opens the pause menu
      screen = (await snap(api)).screen;

      await api.advance(SETTLE_TICKS);
      await api.screenshot("menu");
    },

    async assert(api, check) {
      check.expectEq("the Esc pause menu is reachable", screen, "paused");
    },
  };
}
