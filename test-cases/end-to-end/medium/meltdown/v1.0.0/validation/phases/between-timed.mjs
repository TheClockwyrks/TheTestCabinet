// Automated validation for the Phases sub-item `between-timed`.
//
// The between-wave build phases carry a ~15-second countdown that auto-starts the
// next wave when it expires (specs/economy.md, states.md). We enter the build phase
// before wave 2, confirm the countdown is running and ticks down, then let it expire
// and confirm the next wave auto-starts.

import { newGame, actTail } from "../_helpers.mjs";

export default function item() {
  let start;
  let mid;
  let r;
  let wave;

  return {
    id: "phases.between-timed",

    // Wave 2's build phase — a TIMED one, unlike the opening phase. The countdown's
    // starting value is read here, before anything moves, which is the only place
    // "starts near 15s" can be read at all.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      await api.call("setLives", 100000);
      await api.call("setWave", 2); // a timed between-wave build phase
      start = await api.snapshot();
    },

    // Watch the countdown tick down (180 ticks = the old 3s), then let it run out.
    //
    // The remaining twelve seconds of countdown are POSED away rather than waited
    // out, with the build timer wound down to two. Sitting through a full fifteen
    // seconds of a number decrementing is not evidence of anything the first three
    // do not already establish, and it made this the longest clip in the case for its
    // dullest stretch. `setBuildTimer` is a declared control op for exactly this — it
    // sets a precondition, and the timer that then expires, and the wave that
    // auto-starts when it does, are still entirely the game's own.
    //
    // Both claims survive: the countdown's start value was read in `arrange` at the
    // untouched 15, and `mid` (read before the pose) is what shows it ticking down on
    // its own. Only the waiting is skipped, not the counting.
    //
    // `buildTimer` is in SECONDS: it is a countdown the player reads off the HUD, not
    // an amount of stepping, so its operands stay in seconds while the advances here
    // are in ticks. 300 ticks = a 5s cap on a 2s timer.
    async act(api) {
      await api.advance(180);
      mid = await api.snapshot();

      await api.call("setBuildTimer", 2);
      r = await api.until((s) => s.phase === "wave", { max: 300, poll: 6 });
      wave = (await api.snapshot()).wave;
      await actTail(api, 120); // 2 s of the wave the expiring countdown started
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
