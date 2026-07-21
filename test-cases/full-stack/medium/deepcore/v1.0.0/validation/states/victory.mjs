// Automated validation for states.victory — the Victory screen after a launch is reached and
// captured. Layout is judged by eye from the capture.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let screen;

  return {
    id: "states.victory",

    // Everything the rocket needs, with all five components already fabricated onto it.
    async arrange(api) {
      await newRun(api);
      await api.call("grantCredits", 30000);
      await api.call("giveMaterial", "resonite");
      await api.call("giveMaterial", "cryenite");
      await api.call("spawnCoreSample");
      for (let i = 0; i < 5; i += 1) await api.call("fabricate");
    },

    // The launch sequence is what reaches the screen, and the clip shows it. The settle after it
    // gives the Victory screen a frame to paint before the capture.
    async act(api) {
      await api.call("launch");
      await api.advance(180); // 180 ticks = 3 s: the launch sequence resolves to Victory
      await api.settle(150);
      screen = (await api.snapshot()).screen;
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectEq("the Victory screen is reached", screen, "victory");
    },
  };
}
