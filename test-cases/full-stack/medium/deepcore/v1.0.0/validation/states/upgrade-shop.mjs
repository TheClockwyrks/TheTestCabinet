// Automated validation for states.upgrade-shop — the Upgrade Shop panel is opened (funded so the
// tracks read as affordable) and captured. Layout is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let panel;

  return {
    id: "states.upgrade-shop",

    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 5000);
      await api.call("openPanel", "upgrade-shop");
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the panel has to be on the canvas.
    async act(api) {
      await api.settle(150);
      panel = (await api.snapshot()).panel;
      await api.screenshot("upgrade-shop");
    },

    async assert(api, check) {
      check.expectEq("the Upgrade Shop panel is open", panel, "upgrade-shop");
    },
  };
}
