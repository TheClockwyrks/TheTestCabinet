// Automated validation for fuel.low-warning.
//
// The fuel gauge turns to its alert color (and a low-fuel alarm plays) under 20% of the tank. This
// reaches that state — fuel set below 20% on an underground miner — and captures the HUD; whether
// the gauge actually reads as an alert is left to the reviewer.

import { newRun, solid, ROCKBED_ROW, SPAWN_COL } from "../_helpers.mjs";

export default function item() {
  const col = SPAWN_COL;
  const row = ROCKBED_ROW;
  let snap;

  return {
    id: "fuel.low-warning",

    // A grounded underground miner with its tank set well under the warning threshold.
    async arrange(api) {
      await newRun(api);
      await api.call("teleport", col, row);
      await solid(api, col, row + 1);
      await api.call("teleport", col, row);
      const max = (await api.snapshot()).miner.maxFuel;
      await api.call("setFuel", max * 0.12); // well under the 20% warning threshold
    },

    // The capture is the point of this item, so it happens here — behind a real settle, since the
    // validate pass paints no frame of its own and the alerted gauge has to be on the canvas.
    async act(api) {
      await api.settle(150); // let a frame paint the alerted gauge
      snap = await api.snapshot();
      await api.screenshot("warning");
    },

    async assert(api, check) {
      check.expectLt(
        "fuel is under the 20% warning threshold",
        snap.miner.fuel / snap.miner.maxFuel,
        0.2,
      );
    },
  };
}
