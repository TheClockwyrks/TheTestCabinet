// Automated validation for core-run.extract-timer.
//
// Extracting the Core Sample banks it in the satchel and starts a 90-second destabilization
// countdown that ticks with time. We extract it and confirm the timer starts near 90 and falls with
// stepped time.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let s0;
  let s1;

  return {
    id: "core-run.extract-timer",

    // Extract the Sample and read the freshly-armed timer before any time passes.
    async arrange(api) {
      await newRun(api);
      await api.call("spawnCoreSample");
      s0 = await api.snapshot();
    },

    // The countdown falling with time is the behavior, and the clip shows it running.
    async act(api) {
      await api.advance(300); // 300 ticks = 5 s
      s1 = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq(
        "the Core Sample is now carried",
        s0.satchel.coreSample,
        true,
      );
      check.expectClose("the timer starts near 90s", s0.coreTimer, 90, 0.5);
      check.expectClose(
        "the timer counts down with time",
        s1.coreTimer,
        85,
        0.5,
      );
    },
  };
}
