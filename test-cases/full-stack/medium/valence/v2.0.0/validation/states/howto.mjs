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
    // Both `settle` calls are real repaint pauses in both passes: the first lets the title
    // draw before keys are injected into it, the second lets the how-to screen draw before
    // it is read and captured.
    async act(api) {
      await api.settle(60);
      await navigateMenu(api, 1); // title: CONTAINMENT -> HOW TO PLAY, then confirm
      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq("how to play is reachable", screen, "howto");
    },
  };
}
