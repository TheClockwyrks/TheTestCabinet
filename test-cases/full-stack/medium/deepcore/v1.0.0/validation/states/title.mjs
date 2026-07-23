// Automated validation for states.title — the title / main menu is reachable, and captured so a
// reviewer sees the actual screen. The auto-verdict confirms reachability; layout is left to the reviewer.

import { cleanTitle } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.title",

    async arrange(api) {
      await cleanTitle(api);
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the title has to be on the canvas.
    async act(api) {
      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("title");
    },

    async assert(api, check) {
      check.expectEq("the title is the initial screen", screen, "title");
    },
  };
}
