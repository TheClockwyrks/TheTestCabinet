// Automated validation for states.how-to-play — reached from the title menu, then captured. Layout
// is judged by eye from the capture.

import { cleanTitle, press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.how-to-play",

    async arrange(api) {
      await cleanTitle(api);
    },

    // Walking the menu is what makes the screen REACHABLE, which is the claim under test, so the
    // presses happen here and the clip shows the navigation.
    async act(api) {
      await press(api, "ArrowDown"); // move to How To Play (second entry with no save)
      await press(api, "Enter");
      await api.settle(150); // let the screen paint before the capture
      screen = (await api.snapshot()).screen;
      await api.screenshot("how-to-play");
    },

    async assert(api, check) {
      check.expectEq("how-to-play is reachable", screen, "how-to-play");
    },
  };
}
