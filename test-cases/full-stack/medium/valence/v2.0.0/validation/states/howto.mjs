// Automated validation for the States sub-item `howto`: the how-to-play screen is
// reachable, navigated to from the title with injected keys, and captured.

import { navigateMenu } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.howto",

    async arrange(api) {
      await api.reset();
    },

    // The menu navigation IS the behavior, so it belongs here rather than in the set-up.
    // The `settle` calls are real repaint pauses in both passes: `navigateMenu` opens with
    // one of its own so the title has actually been laid out before keys are injected into it
    // (see MENU_PAINT_MS — a fixed 60 ms here used to land before the first frame on a cold
    // page and read a working build as unreachable), settles again after each confirm, and
    // the one below lets the how-to screen finish drawing before it is captured.
    //
    // `navigateMenu` tries each of the movement and confirm bindings specs/controls.md
    // allows (`Up`/`Down` or `W`/`S`, `Enter` or `Space`) and reports the screen the build
    // actually reached, so the verdict below names it — "mapselect" reads as the menu having
    // confirmed the wrong entry, and "title" as its keyboard accelerators not answering.
    async act(api) {
      screen = await navigateMenu(api, 1); // title: CONTAINMENT -> HOW TO PLAY, then confirm
      await api.settle(150);
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq("how to play is reachable", screen, "howto");
    },
  };
}
