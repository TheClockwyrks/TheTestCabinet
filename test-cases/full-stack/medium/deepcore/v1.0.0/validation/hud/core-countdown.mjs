// Automated validation for hud.core-countdown — a prominent core-sample countdown is shown while the
// Sample is carried. This extracts the Sample and captures the HUD; the countdown's prominence is
// judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let timer;

  return {
    id: "hud.core-countdown",

    async arrange(api) {
      await newRun(api);
      await api.call("spawnCoreSample");
    },

    // The capture is the point, so it happens here behind a real settle — the validate pass paints
    // no frame of its own and the armed countdown has to be on the canvas.
    async act(api) {
      await api.settle(150);
      timer = (await api.snapshot()).coreTimer;
      await api.screenshot("countdown");
    },

    async assert(api, check) {
      check.expectOk("a Core Sample timer is running", timer !== null);
    },
  };
}
