// Automated validation for the States sub-item `mode-select`.
//
// PLAY opens a mode-select menu (specs/ui.md, modes.md). We navigate there with
// injected keys and capture it.

import { press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.mode-select",

    async arrange(api) {
      await api.reset();
    },

    // The navigation is what the clip shows: the title menu giving way to mode
    // select. The settle lets the new screen paint before it is read and captured.
    async act(api) {
      await press(api, "Enter"); // PLAY
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("modeselect");
    },

    async assert(api, check) {
      check.expectEq("PLAY opens mode select", screen, "modeselect");
    },
  };
}
