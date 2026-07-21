// Automated validation for the Phases sub-item `between-timed`.
//
// The between-wave build phases carry a ~15-second countdown that auto-starts the
// next wave when it expires (specs/economy.md, states.md). We enter the build phase
// before wave 2, confirm the countdown is running and ticks down, then let it expire
// and confirm the next wave auto-starts.

import { newGame } from "../_helpers.mjs";

export default function item() {
  let start;
  let mid;
  let r;
  let wave;

  return {
    id: "phases.between-timed",

    // Wave 2's build phase — a TIMED one, unlike the opening phase.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      await api.call("setWave", 2); // a timed between-wave build phase
      start = await api.snapshot();
    },

    // Watch the countdown tick down (180 ticks = the old 3s), then let it run out.
    // 1200 ticks = the old 20s cap, polled every 12 ticks (the old 0.2s chunk) — the
    // phase only changes once, when the timer expires.
    //
    // `buildTimer` is in SECONDS: it is a countdown the player reads off the HUD, not
    // an amount of stepping, so its operands stay in seconds while the advances above
    // are in ticks.
    async act(api) {
      await api.advance(180);
      mid = await api.snapshot();

      r = await api.until((s) => s.phase === "wave", { max: 1200, poll: 12 });
      wave = (await api.snapshot()).wave;
    },

    async assert(api, check) {
      check.expectEq(
        "the between-wave phase is a timed building phase",
        start.phase,
        "building",
      );
      check.expectClose(
        "its countdown starts near 15s",
        start.buildTimer,
        15,
        0.5,
      );
      check.expectLt(
        "the countdown ticks down",
        mid.buildTimer,
        start.buildTimer,
      );
      check.expectOk("the countdown expiring auto-starts the next wave", r.hit);
      check.expectEq("it auto-starts wave 2", wave, 2);
    },
  };
}
