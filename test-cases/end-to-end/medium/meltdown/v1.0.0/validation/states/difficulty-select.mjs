// Automated validation for the States sub-item `difficulty-select`.
//
// Choosing Containment opens a difficulty select (specs/states.md, modes.md).
// Containment leads the mode list, so from the title PLAY then confirm reaches it.

import { press } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.difficulty-select",

    async arrange(api) {
      await api.reset();
    },

    // Two menu steps down to difficulty select. The settle lets the final screen
    // paint before it is read and captured.
    async act(api) {
      await press(api, "Enter"); // PLAY -> mode select
      await press(api, "Enter"); // CONTAINMENT -> difficulty select
      await api.settle(120);
      screen = (await api.snapshot()).screen;
      await api.screenshot("difficulty");
    },

    async assert(api, check) {
      check.expectEq(
        "Containment opens difficulty select",
        screen,
        "difficultyselect",
      );
    },
  };
}
