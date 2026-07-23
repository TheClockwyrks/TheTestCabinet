// Automated validation for states.supply-depot — the Supply Depot panel is opened (funded) and
// captured. Layout is left to the reviewer.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let panel;

  return {
    id: "states.supply-depot",

    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 5000);
      await api.call("openPanel", "supply-depot");
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the panel has to be on the canvas.
    async act(api) {
      await api.settle(150);
      panel = (await api.snapshot()).panel;
      await api.screenshot("supply-depot");
    },

    async assert(api, check) {
      check.expectEq("the Supply Depot panel is open", panel, "supply-depot");
    },
  };
}
