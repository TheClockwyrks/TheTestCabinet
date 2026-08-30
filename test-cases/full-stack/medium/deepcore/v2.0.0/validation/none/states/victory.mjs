// Automated validation for states.victory — the Victory screen after a launch is reached and
// captured. Layout is left to the reviewer.

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
      // Poll until Victory rather than advancing a fixed span: specs/rocket.md bounds no duration
      // for the lift-off animation, so a build may run it longer than any single guess. 600 ticks
      // = 10 s is a generous ceiling for any reasonable sequence.
      const r = await api.until((s) => s.screen === "victory", {
        max: 600,
        poll: 6,
      });
      screen = r.snap.screen;
      await api.settle(150);
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectEq("the Victory screen is reached", screen, "victory");
    },
  };
}
