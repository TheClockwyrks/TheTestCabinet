// Automated validation for states.pause — the Esc pause menu is opened and captured. Layout is
// judged by eye from the capture.

import { newRun, press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.pause",

    async arrange(api) {
      await newRun(api);
    },

    // The Esc press is what reaches the pause menu, which is the claim under test, so it happens
    // here and the clip shows live play being interrupted by it.
    async act(api) {
      await press(api, "Escape"); // opens the pause menu in live play
      await api.settle(150); // let the menu paint before the capture
      screen = (await api.snapshot()).screen;
      await api.screenshot("pause");
    },

    async assert(api, check) {
      check.expectEq("the pause menu is reachable", screen, "paused");
    },
  };
}
