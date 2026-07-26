// Automated validation for states.inventory — the inventory (cargo hold) overlay is opened (with a
// haul to show) and captured. Layout is left to the reviewer.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let panel;

  return {
    id: "states.inventory",

    async arrange(api) {
      await newRun(api);
      await api.call("addCargo", "ferron", 4); // held ore so the overlay has content + weights
      await api.call("openInventory");
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the overlay has to be on the canvas.
    async act(api) {
      await api.settle(150);
      panel = (await api.snapshot()).panel;
      await api.screenshot("inventory");
    },

    async assert(api, check) {
      check.expectEq("the inventory overlay is open", panel, "inventory");
    },
  };
}
