// Automated validation for states.mode-select — reached from the title via New Expedition, then
// captured. Layout is judged by eye from the capture.

import { cleanTitle, press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.mode-select",

    async arrange(api) {
      await cleanTitle(api);
    },

    // Taking New Expedition is what makes the screen REACHABLE, which is the claim under test, so
    // the press happens here and the clip shows the navigation.
    async act(api) {
      await press(api, "Enter"); // New Expedition (the first entry with no save)
      await api.settle(150); // let the screen paint before the capture
      screen = (await api.snapshot()).screen;
      await api.screenshot("mode-select");
    },

    async assert(api, check) {
      check.expectEq("mode select is reachable", screen, "mode-select");
    },
  };
}
