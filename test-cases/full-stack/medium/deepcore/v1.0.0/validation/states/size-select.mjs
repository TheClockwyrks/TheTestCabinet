// Automated validation for states.size-select — reached from the title via New Expedition → a mode,
// then captured. Layout is judged by eye from the capture.

import { cleanTitle, press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.size-select",

    async arrange(api) {
      await cleanTitle(api);
    },

    // Walking the two menus is what makes the screen REACHABLE, which is the claim under test, so
    // the presses happen here and the clip shows the navigation.
    async act(api) {
      await press(api, "Enter"); // New Expedition → mode select
      await press(api, "Enter"); // Standard (the first mode) → size select
      await api.settle(150); // let the screen paint before the capture
      screen = (await api.snapshot()).screen;
      await api.screenshot("size-select");
    },

    async assert(api, check) {
      check.expectEq("size select is reachable", screen, "size-select");
    },
  };
}
