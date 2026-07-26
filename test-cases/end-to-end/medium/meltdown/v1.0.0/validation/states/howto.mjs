// Automated validation for the States sub-item `howto`.
//
// The how-to-play state is reachable (specs/ui.md). HOW TO PLAY is the second
// title entry, so we move down and confirm.

import { press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.howto",

    async arrange(api) {
      await api.reset();
    },

    async act(api) {
      await press(api, "ArrowDown"); // PLAY -> HOW TO PLAY
      await press(api, "Enter");
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("howto");
    },

    async assert(api, check) {
      check.expectEq("HOW TO PLAY opens the how-to screen", screen, "howto");
    },
  };
}
