// Automated validation for states.fuel-depot — the Fuel Depot panel is opened and captured. Layout
// is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let panel;

  return {
    id: "states.fuel-depot",

    async arrange(api) {
      await newRun(api);
      await api.call("openPanel", "fuel-depot");
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the panel has to be on the canvas.
    async act(api) {
      await api.settle(150);
      panel = (await api.snapshot()).panel;
      await api.screenshot("fuel-depot");
    },

    async assert(api, check) {
      check.expectEq("the Fuel Depot panel is open", panel, "fuel-depot");
    },
  };
}
