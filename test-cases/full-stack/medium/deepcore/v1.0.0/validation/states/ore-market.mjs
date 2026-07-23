// Automated validation for states.ore-market — the Ore Market panel is opened (with a haul to show
// the breakdown) and captured. Layout is left to the reviewer.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let panel;

  return {
    id: "states.ore-market",

    async arrange(api) {
      await newRun(api);
      await api.call("addCargo", "cuprite", 3); // a haul so the cargo breakdown has content
      await api.call("openPanel", "ore-market");
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the panel has to be on the canvas.
    async act(api) {
      await api.settle(150);
      panel = (await api.snapshot()).panel;
      await api.screenshot("ore-market");
    },

    async assert(api, check) {
      check.expectEq("the Ore Market panel is open", panel, "ore-market");
    },
  };
}
