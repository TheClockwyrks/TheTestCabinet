// Automated validation for core-run.detonation-death.
//
// If the countdown reaches zero while carrying the Sample it detonates, killing the miner. We
// extract the Sample and run the real sim past the 90-second timer, confirming the core-detonation
// Game Over.

import { newRun } from "../_helpers.mjs";

export default function item() {
  let snap;

  return {
    id: "core-run.detonation-death",

    async arrange(api) {
      await newRun(api);
      await api.call("spawnCoreSample");
    },

    // Run the timer out. 5520 ticks = 92 s: past the 90 s timer plus the death animation. The
    // validate pass covers that instantly; the record pass films the opening of the countdown and
    // stops at the default clip budget, which is the point of the budget — a 92-second clip of a
    // timer ticking down is not worth storing.
    async act(api) {
      await api.advance(5520);
      snap = await api.snapshot();
    },

    async assert(api, check) {
      check.expectEq("the timer expiry ends the run", snap.screen, "game-over");
      check.expectEq(
        "the death cause is a core detonation",
        snap.summary ? snap.summary.deathCause : null,
        "core-detonation",
      );
    },
  };
}
