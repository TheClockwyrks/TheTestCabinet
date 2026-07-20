// Automated validation for the Controls sub-item `mute`.
//
// M toggles mute on any screen (specs/controls.md). From the title (mute off) a
// single M press flips it on.

import { press } from "../_helpers.mjs";

export default function item() {
  let before;
  let after;

  return {
    id: "controls.mute",

    // The title screen, where mute starts off.
    async arrange(api) {
      await api.reset();
    },

    // Read the starting state, press M, read it flip. The settle gives the mute
    // indicator a frame to repaint before the still is captured.
    async act(api) {
      before = (await api.snapshot()).muted;
      await press(api, "KeyM");
      after = (await api.snapshot()).muted;
      await api.settle(120);
      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("M toggles mute on", after, true);
    },
  };
}
