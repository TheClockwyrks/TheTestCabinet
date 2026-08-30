// Automated validation for hud.overload — the cargo readout shows OVERLOAD when the haul is too
// heavy for the jetpack to lift. This poses an over-limit load and captures the HUD; whether the
// readout actually reads OVERLOAD is left to the reviewer.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let overloaded;

  return {
    id: "hud.overload",

    async arrange(api) {
      await newRun(api);
      await api.call("addCargo", "pyronium", 7); // ~406 kg — over the tier-1 lift limit
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the OVERLOAD readout has to be on the canvas.
    async act(api) {
      await api.settle(150);
      overloaded = (await api.snapshot()).miner.overloaded;
      await api.screenshot("overload");
    },

    async assert(api, check) {
      check.expectEq("the load exceeds lift", overloaded, true);
    },
  };
}
