// Automated validation for the Controls item `mute-m`: the M key toggles mute. From the
// title (mute off), a single M press must flip the mute state on; the title is captured
// showing the changed mute hint.
//
// The reset to the title is the precondition (`arrange`); the press is the behavior (`act`).
// The capture is preceded by `api.settle` rather than `api.advance`: the mute hint has to have
// been PAINTED before the screenshot reads the canvas, and stepping the simulation produces no
// frame at all in the validate pass.

import { title } from "../_helpers.mjs";

export default function item() {
  // The mute state before and after the press, read by `assert`.
  let before;
  let after;

  return {
    id: "controls.mute-m",

    async arrange(api) {
      await title(api);
    },

    async act(api) {
      before = (await api.snapshot()).muted;
      await api.call("press", "KeyM");
      after = (await api.snapshot()).muted;

      await api.settle(160); // let the title redraw with the new mute hint
      await api.screenshot("mute");
    },

    async assert(api, check) {
      check.expectEq("mute starts off", before, false);
      check.expectEq("pressing M toggles mute on", after, true);
    },
  };
}
