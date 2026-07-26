// Automated validation for states.launch-pad — the Launch Pad panel (the rocket checklist) is opened
// and captured. Layout is left to the reviewer.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let panel;

  return {
    id: "states.launch-pad",

    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 30000);
      await api.call("openPanel", "launch-pad");
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the panel has to be on the canvas.
    async act(api) {
      await api.settle(150);
      panel = (await api.snapshot()).panel;
      await api.screenshot("launch-pad");
    },

    async assert(api, check) {
      check.expectEq("the Launch Pad panel is open", panel, "launch-pad");
    },
  };
}
